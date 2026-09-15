import { runProbe } from './prose-probe';

let best = { floor: 0, passed: -1 };
for (let floor = 5; floor <= 80; floor += 1) {
  const result = runProbe(floor);
  console.log(`floor ${floor}: ${result.passed}/${result.total}`);
  if (result.passed > best.passed) {
    best = { floor, passed: result.passed };
  }
}
console.log(`\nBest floor: ${best.floor} (${best.passed} passed)`);
