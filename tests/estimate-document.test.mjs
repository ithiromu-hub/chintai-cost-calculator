import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../chintai-cost-calculator.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const functions = script.slice(0, script.indexOf("    monthlyDefaults.forEach"));

function calculator(overrides = {}) {
  const elements = new Map();
  const monthlyRows = [];
  const extraRows = [];
  const drawn = [];
  const rectangles = [];
  const context2d = {
    scale() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    strokeRect() {}, moveTo() {}, lineTo() {}, stroke() {},
    measureText(text) { return { width: String(text).length * (parseFloat(this.font?.match(/[\d.]+px/)?.[0]) || 20) * .65 }; },
    fillText(text, x, y) { drawn.push({ text, x, y }); },
    fillRect(x, y, width, height) { rectangles.push({ x, y, width, height, fill: this.fillStyle }); }
  };
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { value: "", checked: false, textContent: "", innerHTML: "",
      classList: { toggle() {} }, closest: () => ({ classList: { toggle() {} } }) });
    return elements.get(id);
  };
  const document = {
    getElementById: element,
    querySelectorAll: (selector) => selector === "[data-monthly]" ? monthlyRows : selector === "[data-extra]" ? extraRows : [],
    createElement: () => ({ style: {}, getContext: () => context2d })
  };
  const context = vm.createContext({ document, Intl, Date, console });
  vm.runInContext(functions, context);
  const defaults = {
    depositMode: "month", depositValue: "1", keyMoneyMode: "month", keyMoneyValue: "1",
    brokerageMode: "month", brokerageValue: "1.1", guaranteeMode: "percent", guaranteeValue: "50",
    petDepositMode: "month", petDepositValue: "0", freeRentMode: "months", freeRentValue: "0", freeRentTarget: "rent",
    rent: "10万", management: "5000", contractStartDate: "2026-10-15",
    keyExchangeAmountValue: "22000", fireInsuranceAmountValue: "20000"
  };
  Object.entries({ ...defaults, ...overrides }).forEach(([id, value]) => { element(id).value = value; });
  element("includeNextMonth").checked = true;
  element("issuerVisible").checked = true;
  return {
    element, drawn, rectangles,
    run: (code) => vm.runInContext(code, context),
    monthly(name, amount, advance = true, guarantee = true) {
      const id = `monthly${monthlyRows.length}`;
      monthlyRows.push({ dataset: { monthly: id } });
      Object.entries({ Name: name, Value: String(amount), Mode: "amount" }).forEach(([suffix, value]) => { element(id + suffix).value = value; });
      element(id + "IncludeAdvance").checked = advance;
      element(id + "IncludeGuarantee").checked = guarantee;
    },
    extra(name, amount) {
      const id = `extra${extraRows.length}`;
      extraRows.push({ dataset: { extra: id } });
      element(id + "Name").value = name;
      element(id + "Value").value = String(amount);
    }
  };
}

test("帳票明細から仲介手数料を除き、①＋②－申込金と画面合計が一致する", () => {
  const c = calculator({ applicationDeposit: "1万" });
  const totals = c.run("calculate()");
  assert.equal(totals.grandBeforeDeposit, 567081);
  assert.equal(totals.applicationDeposit, 10000);
  assert.equal(totals.grand, 557081);
  assert.equal(c.element("grandTotalTop").textContent, "557,081円");
  const rows = c.run("classicDocumentRows(calculate())");
  assert.equal(rows.filter((row) => row.label.includes("仲介")).length, 0);
  assert.equal(rows.reduce((sum, row) => sum + (row.amount || 0), 0) + 110000 - 10000, totals.grand);
  assert.deepEqual(Array.from(rows.slice(0, 2), (row) => row.label), ["礼 金", "敷 金"]);
  c.run("makeCanvas()");
  assert.equal(c.drawn.filter((item) => item.text.startsWith("②") && item.text.includes("仲介手数料")).length, 1);
  assert.ok(c.drawn.some((item) => item.text === "¥457,081"));
  assert.ok(c.drawn.some((item) => item.text === "¥557,081"));
});

test("日割賃料・管理費・月次費用の分割で丸め差を生じず、対象外月次費用を請求しない", () => {
  for (const day of ["01", "15", "30", "31"]) {
    const c = calculator({ contractStartDate: `2026-10-${day}`, rent: "100001", management: "3333" });
    c.monthly("町会費", 501);
    c.monthly("口座振替", 330, false, false);
    const totals = c.run("calculate()");
    const rows = c.run("classicDocumentRows(calculate())");
    const current = rows.filter((row) => row.style === "prorated");
    assert.equal(current.reduce((sum, row) => sum + row.amount, 0), totals.advance.current.gross);
    assert.equal(current.some((row) => row.label.includes("口座振替")), false);
    assert.equal(rows.reduce((sum, row) => sum + (row.amount || 0), 0) + c.run('lineAmount("brokerage")'), totals.grand);
  }
});

test("月次保証料などは前賃料・保証料の対象外でも上部の月額費用欄に漏れなく表示する", () => {
  const c = calculator();
  const fees = [["月次保証料", 1050], ["口座振替事務手数料", 330], ["町会費", 500], ["火災保険料", 800], ["24時間サポート", 1100], ["駐輪場", 220]];
  fees.forEach(([name, amount]) => c.monthly(name, amount, false, false));
  assert.equal(c.run("calculate().grand"), 567081);
  c.run("makeCanvas()");
  fees.forEach(([name, amount]) => {
    const line = c.drawn.find((item) => item.text === `${name}　¥${new Intl.NumberFormat("ja-JP").format(amount)}`);
    assert.ok(line, `${name}を月額費用欄に表示`);
    assert.ok(line.y >= 316 && line.y < 451);
  });
  assert.ok(c.rectangles.some((item) => item.x === 240 && item.y === 316 && item.width === 835 && item.height === 135 && item.fill === "#fefcda"));
  assert.ok(c.drawn.every((item) => item.y < 1655));
});

test("フリーレント・翌々月・ペット敷金・任意費用も帳票と計算合計が一致する", () => {
  for (const freeRentTarget of ["rent", "rentManagement"]) {
    const c = calculator({ contractStartDate: "2026-12-22", freeRentValue: "1.5", freeRentTarget, petDepositValue: "1" });
    c.element("includeMonthAfter").checked = true;
    c.monthly("サポート", 1100);
    c.extra("清掃費", 33000);
    const totals = c.run("calculate()");
    const rows = c.run("classicDocumentRows(calculate())");
    assert.equal(rows.reduce((sum, row) => sum + (row.amount || 0), 0) + c.run('lineAmount("brokerage")'), totals.grand);
    assert.equal(rows.filter((row) => row.amount < 0).length, 1);
    assert.ok(rows.some((row) => row.label === "1月分 賃料"));
    assert.ok(rows.some((row) => row.label === "2月分 管理費"));
    assert.ok(rows.some((row) => row.label === "敷金積み増し分"));
  }
});

test("ゼロ円の礼金・敷金は残し、未入力欄と預り金なしを見本どおり表示する", () => {
  const c = calculator({ rent: "", management: "", contractStartDate: "", depositValue: "0", keyMoneyValue: "0", fireInsuranceAmountValue: "", keyExchangeAmountValue: "" });
  const rows = c.run("classicDocumentRows(calculate())");
  assert.equal(rows.length, 9);
  assert.equal(rows[0].amount, 0);
  assert.equal(rows[6].amount, null);
  c.run("makeCanvas()");
  assert.ok(c.drawn.some((item) => item.text === "申込金（預り金）"));
  assert.ok(c.rectangles.some((item) => item.fill === "#ffff00"));
  assert.equal(c.run("calculate().grand"), 0);
});

test("預り金が契約金を上回る場合も差額を隠さず表示する", () => {
  const c = calculator({ applicationDeposit: "60万" });
  assert.equal(c.run("calculate().grand"), -32919);
  assert.equal(c.run("classicCurrency(calculate().grand)"), "-¥32,919");
});

test("A4帳票は発行元と備考を含めページ内に収まり、過剰項目は切り捨てず出力を止める", () => {
  const c = calculator({ issuerCompany: "テスト不動産", issuerStaff: "確認担当", issuerAddress: "確認用住所", memo: "確認用の備考" });
  c.monthly("町会費", 500);
  c.run("makeCanvas()");
  assert.ok(c.drawn.every((item) => item.y < 1655));
  assert.ok(c.drawn.some((item) => item.text === "テスト不動産"));
  for (let index = 0; index < 30; index += 1) c.extra(`追加項目${index}`, 1000);
  assert.throws(() => c.run("makeCanvas()"), /A4の1ページに収まりません/);
});
