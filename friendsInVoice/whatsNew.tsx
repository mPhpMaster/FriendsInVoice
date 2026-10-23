/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { classNameFactory } from "@utils/css";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, React } from "@webpack/common";

import { settings } from ".";
import { type Inline, pickReleases, type ReleaseNotes, RELEASES_URL, whatsNewAction } from "./whatsNewNotes";

export const REPO_URL = "https://github.com/mPhpMaster/FriendsInVoice";

const cl = classNameFactory("vc-fiv-");
// saved in this Discord's own storage, so each Discord on the computer shows the window once
const SEEN_KEY = "FriendsInVoice_whatsNewSeen";

const openLink = (url: string) => VencordNative.native.openExternal(url);

function Parts({ parts }: { parts: Inline[]; }) {
    return <>{parts.map((part, i) => {
        let node: React.ReactNode = part.code ? <code>{part.text}</code> : part.text;
        if (part.bold) node = <strong>{node}</strong>;
        if (part.href) node = <span className={cl("link")} onClick={() => openLink(part.href!)}>{node}</span>;
        return <React.Fragment key={i}>{node}</React.Fragment>;
    })}</>;
}

function Release({ release }: { release: ReleaseNotes; }) {
    const items: React.ReactNode[] = [];
    let list: React.ReactNode[] = [];
    const endList = () => {
        if (list.length) items.push(<ul key={items.length}>{list}</ul>);
        list = [];
    };
    release.blocks.forEach((block, i) => {
        if (block.type === "item") return void list.push(<li key={i}><Parts parts={block.parts} /></li>);
        endList();
        items.push(block.type === "heading"
            ? <h3 key={items.length}><Parts parts={block.parts} /></h3>
            : <p key={items.length}><Parts parts={block.parts} /></p>);
    });
    endList();

    return (
        <section className={cl("whats-new-release")}>
            <h2>
                v{release.version}
                <span className={cl("link")} onClick={() => openLink(release.url)}>View on GitHub</span>
            </h2>
            {items}
        </section>
    );
}

function WhatsNewModal({ releases, modalProps }: { releases: ReleaseNotes[]; modalProps: RenderModalProps; }) {
    return (
        <Modal
            {...modalProps}
            title={`Friends in Voice updated to v${releases[0].version}`}
            subtitle="Here's what's new."
            actions={[
                { text: "Open GitHub", variant: "secondary", onClick: () => openLink(REPO_URL) },
                { text: "Got it", variant: "primary", onClick: modalProps.onClose },
            ]}
        >
            <div className={cl("whats-new")}>
                {releases.map(release => <Release key={release.version} release={release} />)}
            </div>
        </Modal>
    );
}

let checked = false;

/** after an update, show the release notes once (called when Discord has loaded) */
export async function showWhatsNew(version: string) {
    if (checked) return;
    checked = true;
    try {
        const seen = await DataStore.get<string>(SEEN_KEY) ?? null;
        const { accountDataOwner, watchlist } = settings.store;
        const action = whatsNewAction(seen, version, !!accountDataOwner || watchlist.length > 0);
        if (action === "nothing") return;
        if (action === "show" && settings.store.showWhatsNew) {
            const res = await fetch(RELEASES_URL, { headers: { Accept: "application/vnd.github+json" } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const releases = pickReleases(await res.json(), seen, version);
            // not published yet (or offline): try again next time Discord starts
            if (!releases.length) return;
            openModal(modalProps => <WhatsNewModal releases={releases} modalProps={modalProps} />);
        }
        await DataStore.set(SEEN_KEY, version);
    } catch {
        checked = false;
    }
}
