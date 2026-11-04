// Admin CLI for a public server (run with the same CT_DATA_DIR):  CT_MODE=public node server/cli.ts <command>
//   create-admin <name> | list | reset <name> | disable <name> | enable <name> | delete <name> | invite [uses] [days] [note] | vapid
// Passwords are generated and printed once; they are never taken from the command line.
process.env.CT_MODE = 'public';
process.env.CT_PUBLIC_URL ??= 'http://localhost'; process.env.CT_ALLOWED_HOSTS ??= 'localhost';
const U = await import('./core/users.ts');
const [cmd, a, b, ...rest] = process.argv.slice(2);
const need = () => { if (!a) throw Error('name required'); return a };
if (cmd === 'create-admin') console.log(`admin ${need()} created. one-time password: ${await U.createAdmin(a)}`);
else if (cmd === 'list') console.table(U.listUsers());
else if (cmd === 'reset') console.log(`temporary password for ${need()}: ${await U.resetPassword(a)}`);
else if (cmd === 'disable' || cmd === 'enable') { U.setStatus(need(), cmd === 'disable' ? 'disabled' : 'active'); console.log('ok') }
else if (cmd === 'delete') { await U.removeUser(need()); console.log('deleted') }
else if (cmd === 'invite') console.log(`invite code (shown once): ${U.createInvite(null, { uses: Number(a) || 1, days: Number(b) || 7, note: rest.join(' ') })}`);
else if (cmd === 'vapid') { const k = (await import('web-push')).default.generateVAPIDKeys(); console.log(`CT_VAPID_PUBLIC=${k.publicKey}\nCT_VAPID_PRIVATE=${k.privateKey}`) }
else { console.log('commands: create-admin <name> | list | reset <name> | disable <name> | enable <name> | delete <name> | invite [uses] [days] [note] | vapid'); process.exitCode = 1 }
process.exit(process.exitCode ?? 0);
export {};
