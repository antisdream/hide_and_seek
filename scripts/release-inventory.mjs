import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";

const root = process.cwd();
const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const dependencies = Object.entries(lock.packages ?? {}).filter(([path]) => path).map(([path, info]) => ({
  path, version: info.version ?? "unknown", license: info.license ?? "REVIEW_REQUIRED", developmentOnly: Boolean(info.dev),
}));
function assets(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? assets(path) : [{ path: relative(root, path).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"), rightsStatus: "MANUAL_PROVENANCE_REVIEW" }];
  });
}
const report = { generatedAt: new Date().toISOString(),
  scope: "잠금 파일의 SPDX 메타데이터와 공개 에셋 해시 목록. 사용 권리나 법률 적합성의 자동 승인이 아님.",
  missingLicenseCount: dependencies.filter((item) => item.license === "REVIEW_REQUIRED").length,
  dependencies, assets: assets(resolve(root, "public")),
  audio: { source: "app/game/game-audio.ts", method: "직접 작성한 음열과 Web Audio 발진기. 외부 녹음/샘플 없음.", review: "새 외부 음원 추가 시 곡별 이용 조건과 증빙을 사람이 확인" } };
const directory = resolve(root, "outputs", "release-20260907");
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "asset-license-inventory.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`의존성 ${dependencies.length}개, 라이선스 메타데이터 미확인 ${report.missingLicenseCount}개, 공개 에셋 ${report.assets.length}개 기록`);
