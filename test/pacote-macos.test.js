"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..");
const BUILD = path.join(REPO_ROOT, "installer", "macos", "build.sh");

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    files.push(target);
    if (entry.isDirectory()) files.push(...walk(target));
  }
  return files;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(result.status, 0, result.stderr || result.stdout || `${command} falhou`);
  return result;
}

test("o pacote macOS real contém somente a aplicação distribuível e o lançador", async (t) => {
  const pkgbuild = spawnSync("pkgbuild", ["--help"], { encoding: "utf8" });
  if (pkgbuild.error && pkgbuild.error.code === "ENOENT") {
    t.skip("pkgbuild não está disponível nesta plataforma");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-pkg-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dist = path.join(root, "dist");
  const expanded = path.join(root, "expanded");
  const version = fs.readFileSync(path.join(REPO_ROOT, "VERSION"), "utf8").trim();
  const pkg = path.join(dist, `Medium-Latens-${version}.pkg`);

  await t.test("não reconstrói Payload nem Bom para remover AppleDouble", () => {
    const buildSource = fs.readFileSync(BUILD, "utf8");
    assert.doesNotMatch(buildSource, /\b(?:cpio|mkbom)\b|numberOfFiles/);
  });

  run("/bin/bash", [BUILD], {
    cwd: REPO_ROOT,
    env: { ...process.env, MEDIUM_LATENS_DIST: dist },
    timeout: 60_000,
  });
  assert.ok(fs.existsSync(pkg), `pacote não gerado em ${pkg}`);
  run("pkgutil", ["--expand", pkg, expanded], { timeout: 30_000 });

  const expandedFiles = walk(expanded);
  const distribution = expandedFiles.find((file) => path.basename(file) === "Distribution");
  const termos = expandedFiles.find((file) => /(?:^|\/)Resources\/TERMOS\.txt$/.test(file));
  assert.ok(distribution, "Distribution ausente no pacote expandido");
  assert.match(fs.readFileSync(distribution, "utf8"), /<license\b[^>]*file="TERMOS\.txt"/);
  assert.ok(termos, "Resources/TERMOS.txt ausente no pacote expandido");
  assert.match(fs.readFileSync(termos, "utf8"), /^# Termos de uso do Medium Latens/);
  const packageInfo = expandedFiles.find((file) => path.basename(file) === "PackageInfo");
  const bom = expandedFiles.find((file) => path.basename(file) === "Bom");
  assert.ok(packageInfo, "PackageInfo ausente no pacote expandido");
  assert.ok(bom, "Bom ausente no pacote expandido");

  const packageInfoText = fs.readFileSync(packageInfo, "utf8");
  assert.match(packageInfoText, /identifier="com\.brunocorrea\.mediumlatens"/);
  await t.test("usa a versão completa do produto", () => {
    assert.match(packageInfoText, new RegExp(`version="${version.replace(/\./g, "\\.")}"`));
  });
  await t.test("permite até duas horas para o postinstall", () => {
    assert.match(packageInfoText, /<postinstall [^>]*timeout="7200"/);
  });
  await t.test("marca o lançador como não relocável", () => {
    assert.doesNotMatch(packageInfoText, /<relocate>/);
  });

  const bomResult = run("lsbom", ["-s", bom]);
  await t.test("o pacote leva o carimbo BUILD de build oficial", () => {
    assert.match(bomResult.stdout, /^\.\/Applications\/Medium Latens\/BUILD$/m);
    const buildSource = fs.readFileSync(BUILD, "utf8");
    assert.match(buildSource, /"oficial": true/);
    assert.match(buildSource, /rev-parse --short HEAD/);
  });
  const bomEntries = bomResult.stdout.split(/\r?\n/).filter(Boolean);
  const appleDoubleEntries = bomEntries.filter(
    (entry) => entry.includes("/._") || entry.startsWith("./._"),
  );
  await t.test("cada AppleDouble tem a entrada irmã de dados", () => {
    const entriesSet = new Set(bomEntries);
    for (const entry of appleDoubleEntries) {
      const sibling = entry.replace(/(^|\/)\._/, "$1");
      assert.ok(entriesSet.has(sibling), `AppleDouble sem entrada irmã: ${entry}`);
    }
  });
  const entries = bomResult.stdout
    .split(/\r?\n/)
    .map((entry) => entry.replace(/^\.\//, "").replace(/\/$/, ""))
    .filter(Boolean);
  const has = (expected) => entries.includes(expected);
  const app = "Applications/Medium Latens";

  for (const expected of [
    `${app}/server.js`,
    `${app}/TERMOS.md`,
    `${app}/lib/envio.js`,
    `${app}/panel/CSXS/manifest.xml`,
    `${app}/installer/bootstrap.sh`,
    `${app}/status/abrir.sh`,
    `${app}/assets/icon/icon.icns`,
    "Applications/Medium Latens.app/Contents/MacOS/abrir",
  ]) {
    assert.ok(has(expected), `ausente no Bom: ${expected}\n${bomResult.stdout}`);
  }
  assert.ok(entries.some((entry) => entry.startsWith(`${app}/lib/`)), "lib/ ausente no Bom");

  await t.test("exclui materiais de desenvolvimento e de Windows", () => {
    const unwanted = entries.filter((entry) => (
      entry === `${app}/windows`
      || entry.startsWith(`${app}/windows/`)
      || entry === `${app}/installer/bootstrap.ps1`
      || entry === `${app}/installer/desinstalar.ps1`
      || entry === `${app}/installer/macos/build.sh`
      || entry === `${app}/.gitignore`
    ));
    assert.deepEqual(unwanted, []);
  });

  const forbidden = /(^|\/)(test|remotion|data|node_modules|\.git)(\/|$)|(^|\/)(\.env|config\.json|credentials\.json)$/;
  assert.equal(entries.filter((entry) => forbidden.test(entry)).join("\n"), "");

  const payload = expandedFiles.find((file) => path.basename(file) === "Payload");
  assert.ok(payload, "Payload ausente no pacote expandido");
  const payloadRoot = path.join(root, "payload");
  fs.mkdirSync(payloadRoot);
  run("/bin/bash", ["-o", "pipefail", "-c", 'gzip -dc "$1" | cpio -idm', "extrair-payload", payload], {
    cwd: payloadRoot,
    timeout: 30_000,
  });
  await t.test("inclui identificação e versão no Info.plist do lançador", () => {
    const infoPlist = path.join(
      payloadRoot,
      "Applications",
      "Medium Latens.app",
      "Contents",
      "Info.plist",
    );
    const plistValue = (key) => run("plutil", ["-extract", key, "raw", infoPlist]).stdout.trim();
    assert.deepEqual(
      {
        packageType: plistValue("CFBundlePackageType"),
        dictionaryVersion: plistValue("CFBundleInfoDictionaryVersion"),
        shortVersion: plistValue("CFBundleShortVersionString"),
        bundleVersion: plistValue("CFBundleVersion"),
      },
      {
        packageType: "APPL",
        dictionaryVersion: "6.0",
        shortVersion: version,
        bundleVersion: version,
      },
    );
  });

  const scripts = expandedFiles.find((file) => path.basename(file) === "Scripts");
  assert.ok(scripts, "Scripts ausente no pacote expandido");
  let postinstall;
  if (fs.statSync(scripts).isDirectory()) {
    postinstall = path.join(scripts, "postinstall");
  } else {
    const scriptsExpanded = path.join(root, "scripts-expanded");
    fs.mkdirSync(scriptsExpanded);
    run("/bin/bash", ["-o", "pipefail", "-c", 'gzip -dc "$1" | cpio -idm', "extrair-scripts", scripts], {
      cwd: scriptsExpanded,
      timeout: 30_000,
    });
    postinstall = path.join(scriptsExpanded, "postinstall");
  }
  assert.ok(fs.existsSync(postinstall), "postinstall ausente em Scripts");
  assert.notEqual(fs.statSync(postinstall).mode & 0o111, 0, "postinstall não está executável");
});
