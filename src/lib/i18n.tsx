import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Lang = "en" | "hi" | "mr";

export const LANG_LABELS: Record<Lang, string> = {
  en: "English",
  hi: "हिन्दी",
  mr: "मराठी",
};

type Dict = Record<string, string>;

const en: Dict = {
  // nav
  "nav.dashboard": "Dashboard",
  "nav.inventory": "Inventory",
  "nav.vendors": "Vendors",
  "nav.expenses": "Expenses",
  "nav.createBill": "Create Bill",
  "nav.import": "Import",
  "nav.export": "Export",
  "nav.reports": "Reports",
  "nav.team": "Team",
  "nav.activity": "Activity",
  "nav.account": "Account",
  "nav.settings": "Settings",
  "nav.parties": "Parties",
  "nav.requests": "Requests",
  "nav.connections": "Connections",
  // common
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.close": "Close",
  "common.add": "Add",
  "common.loading": "Loading…",
  "common.search": "Search…",
  "common.all": "All",
  "common.allShops": "All shops",
  "common.confirm": "Confirm",
  "common.yes": "Yes",
  "common.no": "No",
  "common.name": "Name",
  "common.total": "Total",
  "common.amount": "Amount",
  "common.date": "Date",
  "common.noDataYet": "No data yet",
  // dashboard
  "dash.goodMorning": "Good morning",
  "dash.todayShop": "Here's your shop today",
  "dash.todaysSales": "Today's sales",
  "dash.bills": "Bills",
  "dash.cashInHand": "Cash in hand",
  "dash.voiceHint": "Say: \"10 Parle-G, expiry next March\"",
  "dash.voicePrompt": "Bolo, likh dete hain",
  "dash.needsAttention": "Needs attention",
  "dash.bestSellers": "Best sellers · this week",
  "dash.deadStock": "Dead stock",
  "dash.deadStockHint": "No sale in 30+ days",
  "dash.lowStock": "Low stock",
  "dash.expires": "Expires",
  "dash.addedByVoice": "Added by voice",
  "dash.clear": "Clear",
  // inventory
  "inv.title": "Inventory",
  "inv.stockLedger": "Stock ledger",
  "inv.addItem": "Add item",
  "inv.editItem": "Edit item",
  "inv.recordSale": "Record sale",
  "inv.adjustStock": "Adjust stock",
  "inv.deleteItem": "Delete item",
  "inv.addShop": "+ Add shop",
  "inv.renameShop": "Rename shop",
  "inv.deleteShop": "Delete shop",
  "inv.onShelf": "On shelf",
  "inv.expiringIn30": "Expiring in 30d",
  "inv.item": "Item",
  "inv.category": "Category",
  "inv.stock": "Stock",
  "inv.minStock": "Min stock",
  "inv.price": "Price",
  "inv.costPrice": "Cost price",
  "inv.expiry": "Expiry",
  "inv.shop": "Shop",
  "inv.actions": "Actions",
  "inv.noItems": "No items yet — add your first.",
  "inv.quantity": "Quantity",
  "inv.salePrice": "Sale price",
  "inv.reason": "Reason",
  "inv.newStock": "New stock",
  "inv.cannotSellMore": "Cannot sell more than current stock",
  "inv.confirmDelete": "Delete this item? This cannot be undone.",
  "inv.confirmShopDelete": "Delete this shop? All settings for it will be removed.",
  "inv.shopHasItems": "Move or remove all items from this shop before deleting.",
  // reports
  "rep.title": "Reports",
  "rep.pnl": "Profit & loss",
  "rep.chooseMonth": "Choose month",
  "rep.revenue": "Revenue",
  "rep.cogs": "Cost of goods sold",
  "rep.grossProfit": "Gross profit",
  "rep.otherExpenses": "Other expenses",
  "rep.recurringExpenses": "Recurring expenses",
  "rep.netProfit": "Net profit",
  "rep.netMargin": "net margin",
  "rep.revenueTrend": "Revenue trend",
  "rep.addRecurring": "Add recurring expense",
  "rep.noSales": "No sales yet — record a sale on the Inventory page.",
  "rep.perMonth": "Per month",
  "rep.cadence": "Cadence",
  "rep.monthly": "Monthly",
  "rep.weekly": "Weekly",
  "rep.yearly": "Yearly",
  "rep.oneTime": "One-time",
  // settings
  "set.title": "Settings",
  "set.appLanguage": "App language",
  "set.languageHint": "Choose the language for the app.",
  "set.default": "Default",
  // account
  "acc.title": "Account",
  "acc.fullName": "Full name",
  "acc.phone": "Phone",
  "acc.save": "Save profile",
  "acc.saved": "Saved",
  "acc.logout": "Log out",
  // auth
  "auth.login": "Log in",
  "auth.signup": "Sign up",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.createAccount": "Create account",
  // vendors
  "ven.title": "Vendors",
  "ven.duesPending": "Dues pending",
  "ven.duesSettled": "Dues settled",
  "ven.duesOwed": "Others owe you",
};

const hi: Dict = {
  "nav.dashboard": "डैशबोर्ड",
  "nav.inventory": "इन्वेंटरी",
  "nav.vendors": "विक्रेता",
  "nav.expenses": "खर्च",
  "nav.createBill": "बिल बनाएँ",
  "nav.import": "आयात",
  "nav.export": "निर्यात",
  "nav.reports": "रिपोर्ट",
  "nav.team": "टीम",
  "nav.activity": "गतिविधि",
  "nav.account": "खाता",
  "nav.settings": "सेटिंग्स",
  "nav.parties": "पक्ष",
  "nav.requests": "अनुरोध",
  "nav.connections": "कनेक्शन",
  "common.save": "सहेजें",
  "common.cancel": "रद्द करें",
  "common.delete": "मिटाएँ",
  "common.edit": "संपादित",
  "common.close": "बंद",
  "common.add": "जोड़ें",
  "common.loading": "लोड हो रहा है…",
  "common.search": "खोजें…",
  "common.all": "सभी",
  "common.allShops": "सभी दुकानें",
  "common.confirm": "पुष्टि",
  "common.yes": "हाँ",
  "common.no": "नहीं",
  "common.name": "नाम",
  "common.total": "कुल",
  "common.amount": "राशि",
  "common.date": "तारीख",
  "common.noDataYet": "अभी कोई डेटा नहीं",
  "dash.goodMorning": "नमस्ते",
  "dash.todayShop": "आज की दुकान की झलक",
  "dash.todaysSales": "आज की बिक्री",
  "dash.bills": "बिल",
  "dash.cashInHand": "नकद",
  "dash.voiceHint": "बोलिए: \"10 पारले-जी, मार्च में एक्सपायरी\"",
  "dash.voicePrompt": "बोलिए, लिख देते हैं",
  "dash.needsAttention": "ध्यान दें",
  "dash.bestSellers": "इस हफ्ते के बेस्ट सेलर",
  "dash.deadStock": "बिना बिका माल",
  "dash.deadStockHint": "30+ दिन से बिक्री नहीं",
  "dash.lowStock": "कम स्टॉक",
  "dash.expires": "एक्सपायरी",
  "dash.addedByVoice": "आवाज़ से जोड़ा गया",
  "dash.clear": "साफ़",
  "inv.title": "इन्वेंटरी",
  "inv.stockLedger": "स्टॉक बही",
  "inv.addItem": "आइटम जोड़ें",
  "inv.editItem": "आइटम बदलें",
  "inv.recordSale": "बिक्री दर्ज",
  "inv.adjustStock": "स्टॉक ठीक करें",
  "inv.deleteItem": "आइटम मिटाएँ",
  "inv.addShop": "+ दुकान जोड़ें",
  "inv.renameShop": "दुकान का नाम बदलें",
  "inv.deleteShop": "दुकान मिटाएँ",
  "inv.onShelf": "स्टॉक मूल्य",
  "inv.expiringIn30": "30 दिन में एक्सपायरी",
  "inv.item": "आइटम",
  "inv.category": "श्रेणी",
  "inv.stock": "स्टॉक",
  "inv.minStock": "न्यूनतम स्टॉक",
  "inv.price": "मूल्य",
  "inv.costPrice": "लागत",
  "inv.expiry": "एक्सपायरी",
  "inv.shop": "दुकान",
  "inv.actions": "क्रियाएँ",
  "inv.noItems": "अभी कोई आइटम नहीं — पहला जोड़ें।",
  "inv.quantity": "मात्रा",
  "inv.salePrice": "बिक्री मूल्य",
  "inv.reason": "कारण",
  "inv.newStock": "नया स्टॉक",
  "inv.cannotSellMore": "मौजूदा स्टॉक से ज़्यादा नहीं बेच सकते",
  "inv.confirmDelete": "इस आइटम को मिटाएँ? यह वापस नहीं होगा।",
  "inv.confirmShopDelete": "इस दुकान को मिटाएँ?",
  "inv.shopHasItems": "मिटाने से पहले सभी आइटम हटाएँ या दूसरी दुकान में भेजें।",
  "rep.title": "रिपोर्ट",
  "rep.pnl": "लाभ-हानि",
  "rep.chooseMonth": "महीना चुनें",
  "rep.revenue": "आय",
  "rep.cogs": "माल की लागत",
  "rep.grossProfit": "सकल लाभ",
  "rep.otherExpenses": "अन्य खर्च",
  "rep.recurringExpenses": "नियमित खर्च",
  "rep.netProfit": "शुद्ध लाभ",
  "rep.netMargin": "शुद्ध मार्जिन",
  "rep.revenueTrend": "आय का रुझान",
  "rep.addRecurring": "नियमित खर्च जोड़ें",
  "rep.noSales": "अभी बिक्री नहीं — इन्वेंटरी में बिक्री दर्ज करें।",
  "rep.perMonth": "प्रति माह",
  "rep.cadence": "अवधि",
  "rep.monthly": "मासिक",
  "rep.weekly": "साप्ताहिक",
  "rep.yearly": "वार्षिक",
  "rep.oneTime": "एक बार",
  "set.title": "सेटिंग्स",
  "set.appLanguage": "ऐप की भाषा",
  "set.languageHint": "ऐप की भाषा चुनें।",
  "set.default": "डिफ़ॉल्ट",
  "acc.title": "खाता",
  "acc.fullName": "पूरा नाम",
  "acc.phone": "फ़ोन",
  "acc.save": "प्रोफ़ाइल सहेजें",
  "acc.saved": "सहेजा गया",
  "acc.logout": "लॉग आउट",
  "auth.login": "लॉग इन",
  "auth.signup": "साइन अप",
  "auth.email": "ईमेल",
  "auth.password": "पासवर्ड",
  "auth.createAccount": "खाता बनाएँ",
  "ven.title": "विक्रेता",
  "ven.duesPending": "बकाया शेष",
  "ven.duesSettled": "चुकता",
  "ven.duesOwed": "आपको मिलना",
};

const mr: Dict = {
  "nav.dashboard": "डॅशबोर्ड",
  "nav.inventory": "इन्व्हेंटरी",
  "nav.vendors": "विक्रेते",
  "nav.expenses": "खर्च",
  "nav.createBill": "बिल तयार करा",
  "nav.import": "आयात",
  "nav.export": "निर्यात",
  "nav.reports": "अहवाल",
  "nav.team": "संघ",
  "nav.activity": "क्रियाकलाप",
  "nav.account": "खाते",
  "nav.settings": "सेटिंग्ज",
  "nav.parties": "पक्षकार",
  "nav.requests": "विनंत्या",
  "nav.connections": "जोडणी",
  "common.save": "जतन करा",
  "common.cancel": "रद्द",
  "common.delete": "काढा",
  "common.edit": "संपादित",
  "common.close": "बंद",
  "common.add": "जोडा",
  "common.loading": "लोड होत आहे…",
  "common.search": "शोधा…",
  "common.all": "सर्व",
  "common.allShops": "सर्व दुकाने",
  "common.confirm": "पुष्टी",
  "common.yes": "होय",
  "common.no": "नाही",
  "common.name": "नाव",
  "common.total": "एकूण",
  "common.amount": "रक्कम",
  "common.date": "तारीख",
  "common.noDataYet": "अजून माहिती नाही",
  "dash.goodMorning": "नमस्कार",
  "dash.todayShop": "आजचा दुकानाचा आढावा",
  "dash.todaysSales": "आजची विक्री",
  "dash.bills": "बिले",
  "dash.cashInHand": "रोख",
  "dash.voiceHint": "म्हणा: \"10 पारले-जी, मार्चमध्ये एक्सपायरी\"",
  "dash.voicePrompt": "बोला, आम्ही लिहितो",
  "dash.needsAttention": "लक्ष द्या",
  "dash.bestSellers": "या आठवड्यातील टॉप विक्री",
  "dash.deadStock": "न विकलेला माल",
  "dash.deadStockHint": "30+ दिवसांपासून विक्री नाही",
  "dash.lowStock": "कमी स्टॉक",
  "dash.expires": "एक्सपायरी",
  "dash.addedByVoice": "आवाजातून जोडले",
  "dash.clear": "साफ",
  "inv.title": "इन्व्हेंटरी",
  "inv.stockLedger": "स्टॉक वही",
  "inv.addItem": "वस्तू जोडा",
  "inv.editItem": "वस्तू संपादित",
  "inv.recordSale": "विक्री नोंदवा",
  "inv.adjustStock": "स्टॉक सुधारा",
  "inv.deleteItem": "वस्तू काढा",
  "inv.addShop": "+ दुकान जोडा",
  "inv.renameShop": "दुकानाचे नाव बदला",
  "inv.deleteShop": "दुकान काढा",
  "inv.onShelf": "स्टॉक मूल्य",
  "inv.expiringIn30": "30 दिवसात एक्सपायरी",
  "inv.item": "वस्तू",
  "inv.category": "श्रेणी",
  "inv.stock": "स्टॉक",
  "inv.minStock": "किमान स्टॉक",
  "inv.price": "किंमत",
  "inv.costPrice": "मूळ किंमत",
  "inv.expiry": "एक्सपायरी",
  "inv.shop": "दुकान",
  "inv.actions": "क्रिया",
  "inv.noItems": "अजून वस्तू नाही — पहिली जोडा.",
  "inv.quantity": "प्रमाण",
  "inv.salePrice": "विक्री किंमत",
  "inv.reason": "कारण",
  "inv.newStock": "नवीन स्टॉक",
  "inv.cannotSellMore": "सध्याच्या स्टॉकपेक्षा जास्त विकू शकत नाही",
  "inv.confirmDelete": "ही वस्तू काढायची? हे पूर्ववत होणार नाही.",
  "inv.confirmShopDelete": "हे दुकान काढायचे?",
  "inv.shopHasItems": "काढण्यापूर्वी सर्व वस्तू हलवा किंवा काढा.",
  "rep.title": "अहवाल",
  "rep.pnl": "नफा-तोटा",
  "rep.chooseMonth": "महिना निवडा",
  "rep.revenue": "उत्पन्न",
  "rep.cogs": "मालाची किंमत",
  "rep.grossProfit": "एकूण नफा",
  "rep.otherExpenses": "इतर खर्च",
  "rep.recurringExpenses": "नियमित खर्च",
  "rep.netProfit": "निव्वळ नफा",
  "rep.netMargin": "निव्वळ मार्जिन",
  "rep.revenueTrend": "उत्पन्न कल",
  "rep.addRecurring": "नियमित खर्च जोडा",
  "rep.noSales": "अजून विक्री नाही — इन्व्हेंटरीमधून विक्री नोंदवा.",
  "rep.perMonth": "दरमहा",
  "rep.cadence": "कालावधी",
  "rep.monthly": "मासिक",
  "rep.weekly": "साप्ताहिक",
  "rep.yearly": "वार्षिक",
  "rep.oneTime": "एकदा",
  "set.title": "सेटिंग्ज",
  "set.appLanguage": "अ‍ॅप भाषा",
  "set.languageHint": "अ‍ॅपची भाषा निवडा.",
  "set.default": "डीफॉल्ट",
  "acc.title": "खाते",
  "acc.fullName": "पूर्ण नाव",
  "acc.phone": "फोन",
  "acc.save": "प्रोफाइल जतन",
  "acc.saved": "जतन केले",
  "acc.logout": "लॉग आउट",
  "auth.login": "लॉग इन",
  "auth.signup": "साइन अप",
  "auth.email": "ईमेल",
  "auth.password": "पासवर्ड",
  "auth.createAccount": "खाते तयार करा",
  "ven.title": "विक्रेते",
  "ven.duesPending": "बाकी शिल्लक",
  "ven.duesSettled": "चुकते",
  "ven.duesOwed": "तुम्हाला मिळणार",
};

const DICTS: Record<Lang, Dict> = { en, hi, mr };

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<Ctx>({
  lang: "en",
  setLang: () => {},
  t: (k) => en[k] ?? k,
});

const LOCAL_KEY = "bahi.lang";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === "undefined") return "en";
    const s = localStorage.getItem(LOCAL_KEY);
    return s === "hi" || s === "mr" || s === "en" ? s : "en";
  });

  // Hydrate from profile once we know the user
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("profiles")
        .select("language")
        .eq("id", user.id)
        .maybeSingle();
      const l = data?.language;
      if (!cancelled && (l === "en" || l === "hi" || l === "mr")) {
        setLangState(l);
        if (typeof window !== "undefined") localStorage.setItem(LOCAL_KEY, l);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!s?.user) return;
      supabase
        .from("profiles")
        .select("language")
        .eq("id", s.user.id)
        .maybeSingle()
        .then(({ data }) => {
          const l = data?.language;
          if (l === "en" || l === "hi" || l === "mr") {
            setLangState(l);
            if (typeof window !== "undefined") localStorage.setItem(LOCAL_KEY, l);
          }
        });
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") localStorage.setItem(LOCAL_KEY, l);
    // persist to profile
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("profiles").update({ language: l }).eq("id", user.id).then(() => {});
    });
  };

  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang,
      t: (key: string) => DICTS[lang][key] ?? en[key] ?? key,
    }),
    [lang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext);
}
