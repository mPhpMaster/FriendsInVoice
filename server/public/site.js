"use strict";
// English is in the page itself; this switches it to Arabic (right to left) and back, remembered in this browser.
const ARABIC = {
  title: "Friends in Voice: تثبيت",
  intro: "صفحة تشوف فيها أصحابك بأي روم صوتي ومين معهم، وتدخل عندهم بضغطة. فيها كمان تنبيهات، وقائمة Run away، وسجل، والحرّاس الشخصيين.",
  winIntro: "نزّل المثبّت وافتحه. هو يجيب آخر إصدار، ويثبّت Vencord إذا ما كان عندك، ويضيف الإضافة.",
  winButton: "⬇️ تحميل المثبّت (Windows)",
  winOr: "أو الصق هذا الأمر في PowerShell:",
  winWarning: "Windows ممكن يحذّرك لأن الملف غير موقّع: اضغط «More info» ثم «Run anyway».",
  unixTitle: "macOS و Linux (Vencord)",
  unixIntro: "افتح Terminal والصق:",
  bdIntro: "نزّل ملف الإضافة وحطه في مجلد الإضافات حق BetterDiscord، وبعدين فعّلها.",
  safetyTitle: "الأمان",
  safety1: "الإضافة ما تسوي أي طلبات لديسكورد بالخلفية.",
  safety2: "الحرّاس الشخصيين يتربطون بكود، والأوامر مشفّرة من طرف لطرف عبر هذا السيرفر. ما ينرسل أي توكن ديسكورد.",
  safety3: "المثبّت ينزّل الإصدار من",
  safety3link: "صفحة الإصدارات في GitHub",
  safety3end: "، والكود كله مفتوح."
};
const ENGLISH = { title: document.title };
for (const node of document.querySelectorAll("[data-i18n]")) ENGLISH[node.dataset.i18n] = node.textContent;

function apply(lang) {
  const strings = lang === "ar" ? ARABIC : ENGLISH;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.title = strings.title;
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = strings[node.dataset.i18n];
  for (const node of document.querySelectorAll("[data-lang-toggle]")) node.textContent = lang === "ar" ? "English" : "العربية";
}

let lang = localStorage.getItem("fiv-lang") === "ar" ? "ar" : "en";
for (const node of document.querySelectorAll("[data-lang-toggle]")) node.addEventListener("click", () => {
  lang = lang === "ar" ? "en" : "ar";
  localStorage.setItem("fiv-lang", lang);
  apply(lang);
});
apply(lang);
