import { spawn } from "node:child_process";

/**
 * 하나의 Docker 컨테이너 안에서 웹과 실시간 게임 서버를 함께 관리한다.
 * 어느 한쪽이 비정상 종료되면 다른 프로세스도 정리해 반쪽짜리 서비스가 남지 않게 한다.
 */
const services = [
  launch("웹", ["dist/standalone/server.js"]),
  launch("게임 서버", ["--import", "tsx", "server/index.ts"]),
];

let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shuttingDown = true;
    for (const service of services) service.process.kill(signal);
  });
}

const firstExit = await Promise.race(services.map(({ name, process: child }) => (
  new Promise((resolve) => child.once("exit", (code, signal) => resolve({ name, code, signal })))
)));

for (const service of services) {
  if (service.process.exitCode === null && service.process.signalCode === null) service.process.kill("SIGTERM");
}

if (!shuttingDown) {
  console.error(`[통합 컨테이너] ${firstExit.name} 프로세스가 먼저 종료됐습니다.`, firstExit);
  process.exitCode = firstExit.code ?? 1;
}

function launch(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  child.once("error", (error) => console.error(`[통합 컨테이너] ${name} 시작 실패`, error));
  return { name, process: child };
}
