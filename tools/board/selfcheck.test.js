// E-216 slice 2: the start-up self-check, over captured command output (no real command is run).
const test = require('node:test');
const assert = require('node:assert');
const s = require('./selfcheck');

const NETSH = `
There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : Intel(R) Wi-Fi 6 AX201 160MHz
    State                  : connected
    SSID                   : CERT-Command-Net
    BSSID                  : aa:bb:cc:dd:ee:ff
    Network type           : Infrastructure
`;

test('Wi-Fi name: Windows takes the SSID line and never the BSSID; macOS redaction and Linux', () => {
  assert.strictEqual(s.parseWifiWindows(NETSH), 'CERT-Command-Net');
  assert.strictEqual(s.parseWifiWindows('    State : disconnected\n    BSSID : aa:bb\n'), '');
  assert.strictEqual(s.parseWifiWindows(''), '');
  assert.strictEqual(s.parseWifiMac('<dictionary> {\n  SSID : Field Net\n  BSSID : x\n}'), 'Field Net');
  assert.strictEqual(s.parseWifiMac('  SSID : <redacted>\n'), '');
  assert.strictEqual(s.parseWifiLinux('Ranger Net\n'), 'Ranger Net');
  assert.strictEqual(s.parseWifiLinux(''), '');
});

test('network profiles: one object or an array, enum as a number or a word', () => {
  assert.deepStrictEqual(s.parseNetProfiles('{"InterfaceAlias":"Wi-Fi","NetworkCategory":0}'), [{ alias: 'Wi-Fi', category: 'Public' }]);
  assert.deepStrictEqual(
    s.parseNetProfiles('[{"InterfaceAlias":"Ethernet","NetworkCategory":1},{"InterfaceAlias":"Wi-Fi","NetworkCategory":"Public"}]'),
    [{ alias: 'Ethernet', category: 'Private' }, { alias: 'Wi-Fi', category: 'Public' }]);
  assert.strictEqual(s.parseNetProfiles('not json'), null);
  assert.strictEqual(s.parseNetProfiles(''), null);
});

test('a Public profile only matters on an adapter the Board is reachable through', () => {
  const profiles = [{ alias: 'Wi-Fi', category: 'Private' }, { alias: 'Ethernet 2', category: 'Public' }];
  assert.deepStrictEqual(s.publicProfilesInUse(profiles, ['wi-fi']), []);
  assert.deepStrictEqual(s.publicProfilesInUse(profiles, ['Ethernet 2']).map((p) => p.alias), ['Ethernet 2']);
  assert.deepStrictEqual(s.publicProfilesInUse(profiles, []).map((p) => p.alias), ['Ethernet 2']);
});

test('counts and port owners', () => {
  assert.strictEqual(s.parseCount('0\r\n'), 0);
  assert.strictEqual(s.parseCount('1'), 1);
  assert.strictEqual(s.parseCount('error'), null);

  const NETSTAT = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1032
  TCP    0.0.0.0:443            0.0.0.0:0              LISTENING       4
  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       7712
  TCP    192.168.1.7:50443      52.1.1.1:443           ESTABLISHED     999
`;
  assert.strictEqual(s.parseNetstatPid(NETSTAT, 443), 4);
  assert.strictEqual(s.parseNetstatPid(NETSTAT, 8080), 7712);
  assert.strictEqual(s.parseNetstatPid(NETSTAT, 50443), null, 'established is not listening');
  assert.strictEqual(s.parseNetstatPid(NETSTAT, 9999), null);

  assert.strictEqual(s.parseTasklistName('"nginx.exe","7712","Console","1","12,340 K"\r\n'), 'nginx.exe');
  assert.strictEqual(s.parseTasklistName('INFO: No tasks are running which match the specified criteria.'), '');

  const LSOF = 'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\nnginx    5120 root    6u  IPv4 0x1      0t0  TCP *:443 (LISTEN)\n';
  assert.deepStrictEqual(s.parseLsof(LSOF), { pid: 5120, name: 'nginx' });
  assert.strictEqual(s.parseLsof(''), null);
  assert.strictEqual(s.parseLsof('COMMAND PID USER\n'), null);

  assert.strictEqual(s.describeOwner(4, ''), "Windows' own web service (HTTP.sys)");
  assert.strictEqual(s.describeOwner(7712, 'nginx.exe'), 'nginx.exe');
  assert.strictEqual(s.describeOwner(7712, ''), 'another program (process 7712)');
});

test('power: Windows battery status, macOS pmset', () => {
  assert.strictEqual(s.parseBatteryWindows('1\r\n'), 'battery');
  assert.strictEqual(s.parseBatteryWindows('2\r\n'), 'ac');
  assert.strictEqual(s.parseBatteryWindows('6'), 'ac');
  assert.strictEqual(s.parseBatteryWindows(''), 'desktop');
  assert.strictEqual(s.parseBatteryWindows('weird'), 'unknown');
  assert.strictEqual(s.parsePmset("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1) 80%; discharging"), 'battery');
  assert.strictEqual(s.parsePmset("Now drawing from 'AC Power'\n"), 'ac');
  assert.strictEqual(s.parsePmset(''), 'unknown');
});

test('fix commands quote an adapter name safely and the elevated script survives any quoting', () => {
  assert.strictEqual(s.psQuote("Bob's Wi-Fi"), "'Bob''s Wi-Fi'");
  const cmds = s.fixCommands({ publicAliases: ["Wi-Fi 'x'; calc"], addRule: true, port: 8080 });
  assert.strictEqual(cmds[0], "Set-NetConnectionProfile -InterfaceAlias 'Wi-Fi ''x''; calc' -NetworkCategory Private");
  assert.strictEqual(cmds[1], "New-NetFirewallRule -DisplayName 'RangerTrak Board' -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private");
  const inv = s.elevatedInvocation(cmds);
  assert.match(inv, /^Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-EncodedCommand','[A-Za-z0-9+/=]+'$/);
  const encoded = /'-EncodedCommand','([^']+)'/.exec(inv)[1];
  assert.strictEqual(Buffer.from(encoded, 'base64').toString('utf16le'), cmds.join('; '));
  assert.deepStrictEqual(s.fixCommands({ port: 443 }), []);
});

// A fake command runner keyed on the program name and what the PowerShell text mentions.
function fakeRun(answers) {
  const calls = [];
  const run = async (cmd, args) => {
    const key = cmd === 'powershell' ? ['Get-NetConnectionProfile', 'Get-NetFirewallRule', 'Win32_Battery', 'Start-Process'].find((k) => args[2].includes(k)) : cmd;
    calls.push({ cmd, key, args });
    const a = answers[key];
    return typeof a === 'function' ? a(args) : a || { ok: false, out: '' };
  };
  run.calls = calls;
  return run;
}

// What firewallScript prints: the network types, the firewall on/off per type and the rules that could apply.
const fwOut = (category, rules, on = { Domain: true, Private: true, Public: true }) =>
  JSON.stringify({ profiles: [{ InterfaceAlias: 'Wi-Fi', NetworkCategory: category }], on, rules });
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const nodeRule = (allow, profiles) => ({ name: 'Node.js JavaScript Runtime', node: true, ports: '*', allow, profiles });

test('runSelfCheck on Windows: Public network, nothing lets devices in, on battery -> three things to say', async () => {
  const run = fakeRun({
    'Get-NetConnectionProfile': { ok: true, out: fwOut('Public', [nodeRule(true, 4)]) },
    Win32_Battery: { ok: true, out: '1\r\n' },
  });
  const check = await s.runSelfCheck({ port: 8080, platform: 'win32', inUse: ['Wi-Fi'], program: NODE, run });
  assert.deepStrictEqual(check.network.publicAliases, ['Wi-Fi']);
  assert.strictEqual(check.network.firewall.verdict, 'none', 'a Public-only allow does not count once the network is Private');
  assert.strictEqual(check.power, 'battery');

  const text = s.formatSelfCheck({ check, wifi: 'CERT-Command-Net', virtual: [{ name: 'vEthernet (WSL)', address: '172.28.64.1' }] }).join('\n');
  assert.match(text, /✔ Wi-Fi: CERT-Command-Net/);
  assert.match(text, /· Left out: vEthernet \(WSL\) 172\.28\.64\.1 \(a virtual adapter\)/);
  assert.match(text, /✖ Windows is treating this Wi-Fi as Public/);
  assert.match(text, /Set-NetConnectionProfile -InterfaceAlias 'Wi-Fi' -NetworkCategory Private/);
  assert.match(text, /✖ Firewall: nothing lets other devices reach the Board on Private networks/);
  assert.match(text, /New-NetFirewallRule -DisplayName 'RangerTrak Board' .* -LocalPort 8080 /);
  assert.match(text, /✖ This computer is running on battery\. Keep this computer plugged in/);
  assert.deepStrictEqual(s.offerableFixes(check), { publicAliases: ['Wi-Fi'], addRule: true, unblock: false, program: NODE });
});

test('E-289 Yogurt: Private network, node.exe allowed only on Public -> not reachable, and said so', async () => {
  const run = fakeRun({ 'Get-NetConnectionProfile': { ok: true, out: fwOut('Private', [nodeRule(true, 4), nodeRule(true, 4)]) } });
  const check = await s.runSelfCheck({ port: 443, platform: 'win32', inUse: ['Wi-Fi'], program: NODE, run });
  const text = s.formatSelfCheck({ check, wifi: 'X', inUse: ['Wi-Fi'] }).join('\n');
  assert.match(text, /✔ Windows network type: Private\./);
  assert.doesNotMatch(text, /so other devices can reach the Board/, 'the network type alone never promises a connection');
  assert.match(text, /✖ Firewall: nothing lets other devices reach the Board on Private networks/);
});

test('E-289 BUDDHA: node.exe allowed on Private (blocked on Public) -> fine, no rule offered', async () => {
  const run = fakeRun({
    'Get-NetConnectionProfile': { ok: true, out: fwOut('Private', [nodeRule(false, 4), nodeRule(true, 2)]) },
    Win32_Battery: { ok: true, out: '' },
  });
  const check = await s.runSelfCheck({ port: 443, platform: 'win32', inUse: ['Wi-Fi'], program: NODE, run });
  const lines = s.formatSelfCheck({ check, wifi: 'X' });
  assert.ok(lines.includes('✔ Windows network type: Private.'));
  assert.ok(lines.includes('✔ Firewall: Windows lets other devices reach the Board on Private networks.'));
  assert.ok(lines.some((l) => l.startsWith('· Keep this computer plugged in')), 'the reminder, not the warning');
  assert.ok(!lines.some((l) => l.startsWith('✖')));
  assert.deepStrictEqual(s.offerableFixes(check), { publicAliases: [], addRule: false, unblock: false, program: NODE });
});

test('a node.exe Block rule on Private wins over any allow; the fix turns it off and adds a rule if none is left', async () => {
  const run = fakeRun({ 'Get-NetConnectionProfile': { ok: true, out: fwOut('Private', [nodeRule(false, 2)]) } });
  const check = await s.runSelfCheck({ port: 443, platform: 'win32', inUse: ['Wi-Fi'], program: NODE, run });
  assert.strictEqual(check.network.firewall.verdict, 'blocked');
  const text = s.formatSelfCheck({ check, wifi: 'X' }).join('\n');
  assert.match(text, /✖ Firewall: a Windows Firewall rule blocks the Board on Private networks.*"Node\.js JavaScript Runtime"/);
  assert.match(text, /Get-NetFirewallApplicationFilter -Program 'C:\\Program Files\\nodejs\\node\.exe' .*Disable-NetFirewallRule/);
  assert.match(text, /New-NetFirewallRule/);
  assert.deepStrictEqual(s.offerableFixes(check), { publicAliases: [], addRule: true, unblock: true, program: NODE });

  const boardRule = { name: 'RangerTrak Board', node: false, ports: '443', allow: true, profiles: 2 };
  const withAllow = fakeRun({ 'Get-NetConnectionProfile': { ok: true, out: fwOut('Private', [nodeRule(false, 2), boardRule]) } });
  const c2 = await s.runSelfCheck({ port: 443, platform: 'win32', inUse: ['Wi-Fi'], program: NODE, run: withAllow });
  assert.deepStrictEqual(s.offerableFixes(c2), { publicAliases: [], addRule: false, unblock: true, program: NODE });
});

test('a port rule counts only when it covers the port; a firewall that is off is fine', async () => {
  const portRule = (ports) => fwOut('Private', [{ name: 'Web', node: false, ports, allow: true, profiles: 2147483647 }]);
  for (const [ports, verdict] of [['443', 'allowed'], ['80,443', 'allowed'], ['400-500', 'allowed'], ['*', 'allowed'], ['8080', 'none'], ['RPC', 'none']]) {
    const run = fakeRun({ 'Get-NetConnectionProfile': { ok: true, out: portRule(ports) } });
    const c = await s.runSelfCheck({ port: 443, platform: 'win32', inUse: ['Wi-Fi'], program: NODE, run });
    assert.strictEqual(c.network.firewall.verdict, verdict, ports);
  }
  const off = fakeRun({ 'Get-NetConnectionProfile': { ok: true, out: fwOut('Private', [], { Domain: true, Private: false, Public: true }) } });
  const c = await s.runSelfCheck({ port: 443, platform: 'win32', inUse: ['Wi-Fi'], program: NODE, run: off });
  assert.strictEqual(c.network.firewall.verdict, 'off');
  assert.ok(s.formatSelfCheck({ check: c, wifi: 'X' }).includes('✔ Firewall: Windows Firewall is off for Private networks.'));
});

test('one PowerShell call for the network and the firewall, quoting the program path safely', async () => {
  const run = fakeRun({ 'Get-NetConnectionProfile': { ok: true, out: fwOut('Private', []) } });
  await s.runSelfCheck({ port: 443, platform: 'win32', inUse: [], program: "C:\\Bob's\\node.exe", run });
  const network = run.calls.filter((c) => c.key === 'Get-NetConnectionProfile');
  assert.strictEqual(network.length, 1);
  assert.match(network[0].args[2], /\$node='C:\\Bob''s\\node\.exe';/);
  assert.match(network[0].args[2], /HNetCfg\.FwPolicy2/);
  assert.ok(!run.calls.some((c) => c.key === 'Get-NetFirewallRule'));
});

test('E-289: a wired computer says so instead of "could not read the Wi-Fi name"', () => {
  const check = { platform: 'linux', port: 443, network: null, power: 'ac' };
  assert.match(s.formatSelfCheck({ check, wifi: '', inUse: ['XFinity Ethernet'] })[0], /^✔ Connected by cable \(XFinity Ethernet\)\. Phones and laptops must join a Wi-Fi/);
  assert.match(s.formatSelfCheck({ check, wifi: '', inUse: ['Wi-Fi'] })[0], /^· Wi-Fi name: couldn't read it/);
  assert.match(s.formatSelfCheck({ check, wifi: '', inUse: [] })[0], /^· Wi-Fi name: couldn't read it/);
});

test('the real firewall script runs on this Windows machine and parses', { skip: process.platform !== 'win32' }, async () => {
  const check = await s.runSelfCheck({ port: 443, platform: 'win32', inUse: [], program: process.execPath });
  assert.notStrictEqual(check.network.profiles, null, 'the PowerShell JSON parsed');
  assert.ok(['allowed', 'blocked', 'none', 'off'].includes(check.network.firewall.verdict), check.network.firewall.verdict);
});

test('every failed command is unknown and nothing throws', async () => {
  const run = async () => { throw new Error('boom'); };
  const check = await s.runSelfCheck({ port: 443, platform: 'win32', run: async () => ({ ok: false, out: '' }) });
  assert.strictEqual(check.network.profiles, null);
  assert.strictEqual(check.network.firewall.verdict, 'unknown');
  assert.strictEqual(check.power, 'unknown');
  const text = s.formatSelfCheck({ check, wifi: '' }).join('\n');
  assert.match(text, /Wi-Fi name: couldn't read it/);
  assert.match(text, /Windows network type: couldn't check it/);
  assert.match(text, /Firewall: couldn't check it/);
  assert.strictEqual(await s.readWifi({ platform: 'win32', run }), '');
  assert.strictEqual(await s.portOwner({ port: 443, platform: 'win32', run }), '');
});

test('portOwner: PID 4 is Windows own web service; another PID is named from tasklist; Linux and macOS use lsof', async () => {
  const win = (pid, name) => fakeRun({
    netstat: { ok: true, out: `  TCP    0.0.0.0:443    0.0.0.0:0    LISTENING    ${pid}\n` },
    tasklist: { ok: true, out: name ? `"${name}","${pid}","Console","1","1 K"\n` : 'INFO: none' },
  });
  assert.strictEqual(await s.portOwner({ port: 443, platform: 'win32', run: win(4, '') }), "Windows' own web service (HTTP.sys)");
  assert.strictEqual(await s.portOwner({ port: 443, platform: 'win32', run: win(7712, 'Skype.exe') }), 'Skype.exe');
  assert.strictEqual(await s.portOwner({ port: 443, platform: 'win32', run: win(7712, '') }), 'another program (process 7712)');
  const lsof = fakeRun({ lsof: { ok: true, out: 'COMMAND PID USER\nhttpd 311 root\n' } });
  assert.strictEqual(await s.portOwner({ port: 443, platform: 'darwin', run: lsof }), 'httpd');
});

test('readWifi picks the right command per platform', async () => {
  const run = fakeRun({ netsh: { ok: true, out: NETSH }, ipconfig: { ok: true, out: ' SSID : Mac Net\n' }, iwgetid: { ok: true, out: 'Linux Net\n' } });
  assert.strictEqual(await s.readWifi({ platform: 'win32', run }), 'CERT-Command-Net');
  assert.strictEqual(await s.readWifi({ platform: 'darwin', run }), 'Mac Net');
  assert.strictEqual(await s.readWifi({ platform: 'linux', run }), 'Linux Net');
});

test('the address box is padded with blank lines', () => {
  const box = s.boxedAddress('https://rangertrak-board.local:8080/view');
  assert.strictEqual(box[0], '');
  assert.strictEqual(box[box.length - 1], '');
  assert.ok(box.some((l) => l.includes('https://rangertrak-board.local:8080/view')));
  assert.strictEqual(box[1].length, box[3].length);
});

test('the fix is offered only on Windows, at a keyboard, and only runs after a yes', async () => {
  const win = { platform: 'win32', port: 8080, network: { publicAliases: ['Wi-Fi'], firewall: { verdict: 'none' }, profiles: [] }, power: 'ac' };
  const noop = () => {};
  const yes = async () => true;
  const no = async () => false;

  const r1 = fakeRun({});
  assert.strictEqual(await s.offerFixes({ check: win, isTTY: false, ask: yes, run: r1, log: noop }), 'none');
  assert.strictEqual(r1.calls.length, 0, 'no keyboard, no prompt, nothing run');

  assert.strictEqual(await s.offerFixes({ check: { ...win, platform: 'linux' }, isTTY: true, ask: yes, run: r1, log: noop }), 'none');
  assert.strictEqual(await s.offerFixes({ check: { ...win, network: { publicAliases: [], firewall: { verdict: 'allowed' } } }, isTTY: true, ask: yes, run: r1, log: noop }), 'none');

  const r2 = fakeRun({});
  assert.strictEqual(await s.offerFixes({ check: win, isTTY: true, ask: no, run: r2, log: noop }), 'declined');
  assert.strictEqual(r2.calls.length, 0, 'a no changes nothing');

  let asked = '';
  const r3 = fakeRun({ 'Start-Process': { ok: true, out: '' } });
  assert.strictEqual(await s.offerFixes({ check: win, isTTY: true, ask: async (q) => { asked = q; return true; }, run: r3, log: noop }), 'ran');
  assert.strictEqual(asked, 'Fix these now? Windows will ask for permission. (y/N, 20 s) ');
  assert.strictEqual(r3.calls.length, 1, 'one elevated PowerShell for both fixes');
  assert.match(r3.calls[0].args[2], /-Verb RunAs -Wait/);
});

test('askYesNo: y and yes are yes; anything else, and silence, is no', async () => {
  const { PassThrough } = require('node:stream');
  const attempt = async (typed, ms = 500) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const p = s.askYesNo('? ', ms, { input, output });
    if (typed !== null) input.write(typed + '\n');
    return p;
  };
  assert.strictEqual(await attempt('y'), true);
  assert.strictEqual(await attempt('Yes'), true);
  assert.strictEqual(await attempt(''), false);
  assert.strictEqual(await attempt('n'), false);
  assert.strictEqual(await attempt('yep'), false);
  assert.strictEqual(await attempt(null, 50), false, 'the timeout is a no');
});
