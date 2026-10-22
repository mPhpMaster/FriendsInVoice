import { GUARD_ACTIONS, GUARD_LABELS } from "../../friendsInVoice/personalGuardsProtocol.ts";

function listItem(view, id, key, addText, removeText) {
    return {
        id: `fivbd-${key}`,
        label: view.data.listHas(key, id) ? removeText : addText,
        action: () => { view.data.toggleList(key, id); view.refresh(); }
    };
}

export function installUserMenu(api, view) {
    return api.ContextMenu.patch("user-context", (tree, props, instance) => {
        try {
            const user = props?.user ?? props?.contextMenuAPIArguments?.[0]?.user ??
                instance?.props?.user ?? tree?.props?.user ?? tree?.props?.contextMenuAPIArguments?.[0]?.user ??
                api.Utils?.findInTree?.(tree, item => !!item?.user?.id, { walkable: ["props", "children"] })?.user;
            const id = user?.id;
            if (!id || id === view.bridge.currentId()) return;
            const known = view.guards.knownFor(id);
            const available = view.bridge.sharesVoice(id) ? GUARD_ACTIONS.filter(action => known.includes(action)) : [];
            const guardItems = [
                {
                    id: "fivbd-add-guardian",
                    label: view.data.value.personalGuards.some(item => item.userId === id) ? "Manage guardian" : "Add as Guardian",
                    action: () => {
                        if (!view.data.value.personalGuards.some(item => item.userId === id)) view.data.grant(id, []);
                        view.open("guards");
                    }
                },
                { id: "fivbd-offer-guard", label: "Offer to guard (prepare secure key DM)", action: () => void view.guards.sendKey(id) },
                ...available.map(action => ({
                    id: `fivbd-guard-${action}`, label: `Prepare ${GUARD_LABELS[action]} DM`,
                    action: () => void view.guards.sendCommand(id, action)
                }))
            ];
            const items = api.ContextMenu.buildMenuChildren([{
                type: "group",
                items: [
                    listItem(view, id, "watchlist", "Add to My List", "Remove from My List"),
                    listItem(view, id, "notifyOnline", "Notify when online", "Stop online alerts"),
                    listItem(view, id, "notifyVoice", "Notify when in voice", "Stop voice alerts"),
                    listItem(view, id, "blacklist", "Add to Run Away", "Remove from Run Away"),
                    listItem(view, id, "hidden", "Hide from In Voice", "Show in In Voice"),
                    { type: "submenu", id: "fivbd-guards", label: "Personal Guards", items: guardItems }
                ]
            }]);
            const children = tree?.props?.children;
            if (Array.isArray(children)) children.push(...items);
            else if (children && tree.props) tree.props.children = [children, ...items];
        } catch (error) { api.Logger.error("Could not add FriendsInVoice user menu", error); }
    });
}
