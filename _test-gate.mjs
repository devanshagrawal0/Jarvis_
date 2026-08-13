import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { auditFaithfulness } = require("./server/stage-faithfulness");

// The real fetched payload (what a LIVE fetch returned).
const payload = { revenue: 1845.5, orders: 214, avgTicket: 8.62, note: "S&P 500 closed at 5432, +0.6%" };

// 1) Faithful render — every number traces to the payload -> must PASS.
const faithful = [
  { type: "heading", text: "Coffee Shop — Today" },
  { type: "stat", label: "Revenue", value: "$1,845.50", delta: "+0.6%" },
  { type: "stat", label: "Orders", value: "214" },
  { type: "stat", label: "Avg ticket", value: "$8.62" },
  { type: "list", items: ["S&P 500 at 5432"] },
];

// 2) Fabricated render — invents numbers NOT in the payload -> must FAIL and name them.
const fabricated = [
  { type: "heading", text: "Coffee Shop — Today" },
  { type: "stat", label: "Revenue", value: "$9,999.00", delta: "+42%" }, // invented
  { type: "stat", label: "Orders", value: "214" },                        // real
  { type: "stat", label: "Foot traffic", value: "1,203 visitors" },       // invented
];

const a = auditFaithfulness(faithful, payload);
const b = auditFaithfulness(fabricated, payload);

console.log("FAITHFUL  -> ok:", a.ok, "| checked:", a.checked, "| violations:", a.violations.length);
console.log("FABRICATED-> ok:", b.ok, "| checked:", b.checked, "| violations:", JSON.stringify(b.violations));

const pass = a.ok === true && a.violations.length === 0
  && b.ok === false && b.violations.some((v) => v.value === 9999) && b.violations.some((v) => v.value === 1203) && b.violations.some((v) => v.value === 42);
console.log(pass ? "\nGATE TEST PASSED (green on real data, red on the invented numbers)" : "\nGATE TEST FAILED");
