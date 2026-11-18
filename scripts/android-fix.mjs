/**
 * android-fix.mjs — 让 Capacitor 8 项目能在 JDK 17 下构建
 *
 * 背景：Capacitor 8 的模板把 sourceCompatibility 钉死为 Java 21，而本机只有
 * JDK 17。Capacitor 的 Android 代码没有使用 Java 21 独有特性，降到 17 不影响
 * 功能。其中两个文件由 `cap sync` 自动生成，所以每次 sync 后都要重跑本脚本。
 *
 * 另外修三件事（都是本机环境的硬性障碍）：
 *   - gradle.properties：允许含中文的项目路径（AGP 默认拒绝）
 *   - local.properties：指向本机 Android SDK
 *   - wrapper 镜像：services.gradle.org 常超时，改走腾讯镜像
 *
 * 用法：node scripts/android-fix.mjs learner|monitor
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const app = process.argv[2];
if (!['learner', 'monitor'].includes(app)) {
  console.error('用法: node scripts/android-fix.mjs learner|monitor');
  process.exit(2);
}

const ANDROID = join(ROOT, 'apps', app, 'android');
if (!existsSync(ANDROID)) {
  console.error(`找不到 ${ANDROID}，先跑 cap add android`);
  process.exit(1);
}

const patched = [];

// 1) 自动生成的两个 gradle：Java 21 -> 17
for (const rel of ['app/capacitor.build.gradle', 'capacitor-cordova-android-plugins/build.gradle']) {
  const p = join(ANDROID, rel);
  if (!existsSync(p)) continue;
  const c = readFileSync(p, 'utf8');
  if (c.includes('JavaVersion.VERSION_21')) {
    writeFileSync(p, c.replaceAll('JavaVersion.VERSION_21', 'JavaVersion.VERSION_17'), 'utf8');
    patched.push(rel);
  }
}

// 1b) 已安装的 Capacitor 插件同样把 sourceCompatibility 钉死为 Java 21
//     （@capacitor/status-bar 就是这样）。它们躺在 node_modules 里，
//     必须一并降到 17，否则 JDK 17 构建报「无效源发行版: 21」。
//     cap sync 之后要重跑本脚本，所以这里做成幂等扫描。
const candidates = new Set();
const store = join(ROOT, 'node_modules', '.pnpm');
if (existsSync(store)) {
  for (const d of readdirSync(store, { withFileTypes: true })) {
    if (!d.isDirectory() || !d.name.startsWith('@capacitor+')) continue;
    const pkgRoot = join(store, d.name, 'node_modules', '@capacitor');
    if (existsSync(pkgRoot)) {
      for (const p of readdirSync(pkgRoot)) candidates.add(join(pkgRoot, p, 'android', 'build.gradle'));
    }
  }
}
const local = join(ROOT, 'apps', app, 'node_modules', '@capacitor');
if (existsSync(local)) {
  for (const p of readdirSync(local)) candidates.add(join(local, p, 'android', 'build.gradle'));
}

let pluginPatched = 0;
for (const bg of candidates) {
  if (!existsSync(bg)) continue;
  const c = readFileSync(bg, 'utf8');
  if (c.includes('JavaVersion.VERSION_21')) {
    writeFileSync(bg, c.replaceAll('JavaVersion.VERSION_21', 'JavaVersion.VERSION_17'), 'utf8');
    pluginPatched++;
  }
}
if (pluginPatched) patched.push(`${pluginPatched} 个插件 build.gradle`);

// 2) app/build.gradle：补 compileOptions（幂等）
//    签名不再由本脚本注入：build.gradle 自己读 android/keystore.properties，
//    该文件与 .keystore 都不进仓库，所以脚本里不留任何密钥或口令。
const appGradle = join(ANDROID, 'app', 'build.gradle');
if (existsSync(appGradle)) {
  let c = readFileSync(appGradle, 'utf8');
  let changed = false;

  if (!c.includes('compileOptions')) {
    c = c.replace(
      /(\n\s*buildTypes\s*\{)/,
      `
    // Capacitor 8 模板要求 Java 21；本机 JDK 17，降到 17 不影响功能。
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
$1`,
    );
    changed = true;
  }

  if (changed) {
    writeFileSync(appGradle, c, 'utf8');
    patched.push('app/build.gradle');
  }
}

// 3) gradle.properties：允许非 ASCII 项目路径
const gp = join(ANDROID, 'gradle.properties');
const current = existsSync(gp) ? readFileSync(gp, 'utf8') : '';
if (!current.includes('overridePathCheck')) {
  writeFileSync(
    gp,
    [
      '# Project-wide Gradle settings.',
      'org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m',
      'android.useAndroidX=true',
      'android.enableJetifier=false',
      '# The project path contains non-ASCII characters (user-chosen directory).',
      '# AGP refuses to build by default; this is the documented opt-out.',
      'android.overridePathCheck=true',
      '',
    ].join('\n'),
    'utf8',
  );
  patched.push('gradle.properties');
}

// 4) local.properties：指向 SDK
const lp = join(ANDROID, 'local.properties');
if (!existsSync(lp)) {
  writeFileSync(lp, 'sdk.dir=D:\\\\Android\\\\Sdk\n', 'ascii');
  patched.push('local.properties');
}

// 5) wrapper：走腾讯镜像并放宽超时
const wp = join(ANDROID, 'gradle', 'wrapper', 'gradle-wrapper.properties');
if (existsSync(wp)) {
  let c = readFileSync(wp, 'utf8');
  if (c.includes('services.gradle.org')) {
    c = c.replace(/https\\?:\/\/services\.gradle\.org\/distributions/g, 'https\\://mirrors.cloud.tencent.com/gradle');
    c = c.replace('networkTimeout=10000', 'networkTimeout=120000');
    writeFileSync(wp, c, 'utf8');
    patched.push('gradle-wrapper.properties');
  }
}

if (patched.length === 0) {
  console.log(`  ${app}: 已是修好的状态`);
} else {
  console.log(`  ${app}: 修复 ${patched.join(', ')}`);
}