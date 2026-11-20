// Prints the ADMIN_PASSWORD_HASH line for a password read from stdin, or for a new random password
// (printed too) when stdin is empty: `node hash-password.mjs < password.txt`
import { randomBytes } from "node:crypto";

import { hashPassword } from "./admin.mjs";

let input = "";
if (!process.stdin.isTTY) for await (const chunk of process.stdin) input += chunk;
let password = input.trim();
if (!password) {
    password = randomBytes(15).toString("base64url");
    console.error(`New admin password: ${password}`);
}
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
