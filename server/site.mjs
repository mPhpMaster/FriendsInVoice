// The public site: an install page and the web installers. Files are read once at start from ./public.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FILES = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/site.css": ["site.css", "text/css; charset=utf-8"],
    "/install.ps1": ["install.ps1", "text/plain; charset=utf-8"],
    "/install.sh": ["install.sh", "text/plain; charset=utf-8"],
    "/FriendsInVoice-Installer.bat": ["FriendsInVoice-Installer.bat", "application/octet-stream", "attachment"],
};

export function createSite(directory = fileURLToPath(new URL("./public/", import.meta.url))) {
    const files = new Map();
    for (const [path, [name, type, disposition]] of Object.entries(FILES)) {
        let body = readFileSync(join(directory, name));
        // Windows runs .bat files with CRLF line endings only reliably
        if (name.endsWith(".bat")) body = Buffer.from(body.toString("utf8").replace(/\r?\n/g, "\r\n"));
        // PowerShell and bash scripts must keep plain LF so they parse the same everywhere
        else if (/\.(ps1|sh)$/.test(name)) body = Buffer.from(body.toString("utf8").replace(/\r\n/g, "\n"));
        files.set(path, { body, type, disposition: disposition ? `${disposition}; filename="${name}"` : undefined });
    }
    return function handle(request, response, url) {
        if (request.method !== "GET" && request.method !== "HEAD") return false;
        const file = files.get(url.pathname === "/index.html" ? "/" : url.pathname);
        if (!file) return false;
        response.writeHead(200, {
            "content-type": file.type, "content-length": file.body.length, "cache-control": "public, max-age=300",
            "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
            "content-security-policy": "default-src 'none'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
            ...(file.disposition ? { "content-disposition": file.disposition } : {}),
        });
        response.end(request.method === "HEAD" ? undefined : file.body);
        return true;
    };
}
