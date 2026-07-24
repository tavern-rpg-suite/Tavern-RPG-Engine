import { getContext, extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveChatDebounced, saveSettingsDebounced, saveSettings as stSaveSettings, setExtensionPrompt, extension_prompt_roles, characters } from '../../../../script.js';

const MODULE_NAME = 'tavern_rpg_engine';
const PROMPT_KEY = 'rpg_status_injection';

const defaultSettings = {
    enabled: false,
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: 'google/gemma-4-31b-it',
    temperature: 0.7,
    eventMinMessages: 10,
    eventMaxMessages: 30,
    injectDepth: 1,
    language: 'en',
    carryCapacity: 50,
    gmMode: false,
    announceUse: true,
    chatStates: {},
    chatStamps: {}   // chatId -> last-used timestamp, lets stale states be pruned
};

let settings = {};

// The model sometimes returns junk instead of a string (-1, 0, "null", bare numbers…).
// String(x || fallback) let it through because -1 is truthy — that is how "-1" events
// and "-1" items were born. A usable AI name must contain at least one letter.
function aiName(x, fallback = null, maxLen = 60) {
    const s = String(x == null ? '' : x).trim();
    if (s.length < 2 || !/\p{L}/u.test(s)) return fallback;
    if (/^(null|undefined|n\/?a|none|нет|-?\d+)$/i.test(s)) return fallback;
    return s.slice(0, maxLen);
}

function escapeHtml(x) {
    return String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function genLang() { return settings.language === 'ru' ? 'Russian' : 'English'; }
const I18N = {
    en: {
        btn_quests: 'Active Quests', btn_backpack: 'Backpack', btn_search: 'Search for items',
        inv_title: 'Your Inventory', workbench: 'Workbench', slot_base: 'Base', slot_material: 'Material',
        upgrade_item: 'Upgrade Item', ai_analysis: 'AI analysis...',
        slot_hint_base: 'Click an item<br>(Base)', slot_hint_material: 'Click an item<br>(Material)',
        click_remove: '(Click — remove)', click_to_remove: 'Click to remove',
        item_success: 'Success: {chance}%', discard: 'Discard',
        coins_label: 'Coins', weight_label: 'Weight', eat: 'Eat', coins_add: 'Add coins', coins_sub: 'Remove coins', use_item: 'Use', used: '{name} used.', used_heal: '+{n} HP.', used_fed: 'Satiety +{n}.', used_buff: 'Effect: {name}.', to_coins: 'Turn into coins', tc_checking: 'Counting it out...', tc_yes: 'Converted {name} → +{n} coins. {reason}', tc_no: "{name} isn't money: {reason}", tc_err: 'Could not convert — check URL / key / model.', uc_checking: 'Trying it...', uc_no: "{name} can't be eaten or drunk: {reason}", use_verb: 'uses {name}', set_announce: 'Announce eating / drinking in the chat (so the AI narrates it)',
        tag_weapon: 'weapon', tag_armor: 'armor', tag_clothing: 'clothing', tag_material: 'material', tag_food: 'food', tag_consumable: 'consumable', tag_misc: 'misc',
        toast_ate: 'You ate {name}. +{n} HP.', toast_ate_nohp: 'You ate {name}.',
        set_capacity: 'Carry capacity:', set_gm: 'GM / edit mode (manual coins)',
        inject_encumbered: '{{user}} is over-encumbered (carrying {w}/{cap}); movement is slow and tiring',
        card_title: 'Click — use in chat\nShift+Click — to Workbench',
        loot_found: 'You found items!', take_all: 'Take all', take_selected: 'Take selected', leave: 'Leave',
        letter: 'Letter',
        quest_empty: 'All quiet right now...<br>No new letters have arrived. Keep chatting!',
        new_case: 'New case', no_mail: 'NO MAIL', close_lbl: 'Close', q_quiet_h: 'All quiet right now…', q_quiet_p: 'No new letters have arrived. Keep chatting!', reward: 'Reward', experience: 'Experience',
        accept: 'Accept', ignore: 'Ignore', complete: 'Complete (Success)', fail: 'Fail',
        in_progress: 'In progress', play_hint: 'Play out the situation in chat, then choose the outcome',
        insert_event: 'Insert event into chat', insert_title: 'Insert the event text into the input field',
        sealed: 'Sealed letter',
        set_title: 'RPG Engine (Inventory & Events)', set_enable: 'Enable Module',
        set_event_every: 'Event every', set_to: 'to', set_depth: 'Context injection depth:',
        set_lang: 'Language:', set_url: 'URL', set_key: 'API Key', set_model: 'Model',
        toast_restore: 'Backpack restored from the chat backup!',
        toast_starting: 'Starting items added to your backpack!',
        toast_nothing_here: 'Nothing else to find here.', toast_searching: 'Searching the area...',
        toast_found_nothing: 'You found nothing.', forage_found_desc: 'A foraged ingredient.', toast_search_err: 'Search error.',
        toast_items_added: 'Items added to inventory!',
        toast_craft_impossible: 'Crafting impossible: {reason}',
        toast_craft_ok: 'Success! You crafted: {name}. New chance: {chance}%',
        toast_craft_fail: 'Failure... You ruined the item. New chance: {chance}%',
        toast_craft_err: 'Crafting error.', toast_new_event: 'New event in the journal!',
        toast_event_err: 'Failed to create an event — check the URL / key / model in the engine settings.',
        toast_event_started: 'Event started! Play it out in the chat.',
        toast_event_ignored: 'You ignored the event.',
        toast_reward: 'Success! Reward received: {name}!', toast_failed: 'You failed...', toast_fail_debuff: 'A setback clings to you (debuff applied).', event_fail_debuff_name: 'Setback', event_fail_debuff_eff: 'Shaken by a recent failure — a run of bad luck and lowered footing',
        toast_event_inserted: 'Event added to the input field — edit if you like and send.'
    },
    ru: {
        btn_quests: 'Активные задания', btn_backpack: 'Рюкзак', btn_search: 'Искать предметы',
        inv_title: 'Твой инвентарь', workbench: 'Верстак', slot_base: 'Основа', slot_material: 'Материал',
        upgrade_item: 'Улучшить предмет', ai_analysis: 'Анализ ИИ...',
        slot_hint_base: 'Выбери предмет<br>(Основа)', slot_hint_material: 'Выбери предмет<br>(Материал)',
        click_remove: '(Клик — убрать)', click_to_remove: 'Клик, чтобы убрать',
        item_success: 'Успех: {chance}%', discard: 'Выбросить',
        coins_label: 'Монеты', weight_label: 'Вес', eat: 'Съесть', coins_add: 'Добавить монеты', coins_sub: 'Убрать монеты', use_item: 'Использовать', used: '{name} использовано.', used_heal: '+{n} HP.', used_fed: 'Сытость +{n}.', used_buff: 'Эффект: {name}.', to_coins: 'Перевести в монеты', tc_checking: 'Пересчитываю...', tc_yes: 'Перевод: «{name}» → +{n} монет. {reason}', tc_no: '«{name}» — это не деньги: {reason}', tc_err: 'Не удалось перевести — проверь URL / ключ / модель.', uc_checking: 'Пробую...', uc_no: '«{name}» нельзя съесть или выпить: {reason}', use_verb: 'использует «{name}»', set_announce: 'Объявлять еду / питьё в чате (чтобы ИИ это отыграл)',
        tag_weapon: 'оружие', tag_armor: 'броня', tag_clothing: 'одежда', tag_material: 'материал', tag_food: 'еда', tag_consumable: 'расходник', tag_misc: 'прочее',
        toast_ate: 'Ты съел(а) {name}. +{n} HP.', toast_ate_nohp: 'Ты съел(а) {name}.',
        set_capacity: 'Грузоподъёмность:', set_gm: 'GM / режим редактирования (монеты вручную)',
        inject_encumbered: '{{user}} перегружен(а) (несёт {w}/{cap}); движение медленное и утомительное',
        card_title: 'Клик — использовать в чате\nShift+Клик — на верстак',
        loot_found: 'Ты нашёл предметы!', take_all: 'Взять всё', take_selected: 'Взять выбранное', leave: 'Оставить',
        letter: 'Письмо',
        quest_empty: 'Пока всё тихо...<br>Новых писем нет. Продолжай общаться!',
        new_case: 'Новое дело', no_mail: 'НЕТ ПИСЕМ', close_lbl: 'Закрыть', q_quiet_h: 'Пока всё тихо…', q_quiet_p: 'Новых писем нет. Продолжай общаться!', reward: 'Награда', experience: 'Опыт',
        accept: 'Принять', ignore: 'Игнорировать', complete: 'Завершить (успех)', fail: 'Провал',
        in_progress: 'В процессе', play_hint: 'Отыграй ситуацию в чате, затем выбери исход',
        insert_event: 'Вставить событие в чат', insert_title: 'Вставить текст события в поле ввода',
        sealed: 'Запечатанное письмо',
        set_title: 'RPG Engine (инвентарь и события)', set_enable: 'Включить модуль',
        set_event_every: 'Событие каждые', set_to: 'до', set_depth: 'Глубина вставки в контекст:',
        set_lang: 'Язык:', set_url: 'URL', set_key: 'API-ключ', set_model: 'Модель',
        toast_restore: 'Рюкзак восстановлен из резервной копии чата!',
        toast_starting: 'Стартовые предметы добавлены в рюкзак!',
        toast_nothing_here: 'Здесь больше нечего найти.', toast_searching: 'Осматриваю местность...',
        toast_found_nothing: 'Ты ничего не нашёл.', forage_found_desc: 'Добытый ингредиент.', toast_search_err: 'Ошибка поиска.',
        toast_items_added: 'Предметы добавлены в инвентарь!',
        toast_craft_impossible: 'Крафт невозможен: {reason}',
        toast_craft_ok: 'Успех! Ты создал: {name}. Новый шанс: {chance}%',
        toast_craft_fail: 'Неудача... Ты испортил предмет. Новый шанс: {chance}%',
        toast_craft_err: 'Ошибка крафта.', toast_new_event: 'Новое событие в журнале!',
        toast_event_err: 'Не удалось создать событие — проверь URL / ключ / модель в настройках движка.',
        toast_event_started: 'Событие началось! Отыграй его в чате.',
        toast_event_ignored: 'Ты проигнорировал событие.',
        toast_reward: 'Успех! Получена награда: {name}!', toast_failed: 'Ты провалил...', toast_fail_debuff: 'Неудача липнет к тебе (наложен дебаф).', event_fail_debuff_name: 'Неудача', event_fail_debuff_eff: 'Выбит из колеи после провала — полоса невезения и шаткое положение',
        toast_event_inserted: 'Событие добавлено в поле ввода — поправь при желании и отправь.'
    }
};
function t(key, vars) {
    const lang = settings.language === 'ru' ? 'ru' : 'en';
    let str = (I18N[lang] && I18N[lang][key] !== undefined) ? I18N[lang][key] : (I18N.en[key] !== undefined ? I18N.en[key] : key);
    if (vars) for (const k in vars) str = str.split('{' + k + '}').join(vars[k]);
    return str;
}

let gameState = {
    inventory: [],
    coins: 0,
    messagesUntilEvent: 15,
    activeEvent: null,
    activeDebuff: null,
    lootGenerated: false,
    forageQuests: [] // ingredient hunts taken from vendors; the loupe can turn these up while foraging
};

let craftSlotBase = null;
let craftSlotMaterial = null;

// ============================================================
// CHAT OWNERSHIP
// The backpack belongs to exactly one chat. A save issued while SillyTavern is still
// swapping chats would otherwise write the previous chat's state under the new chat id
// (and into the new chat's checkpoint), leaking items between chats.
// ============================================================
let currentChatId = null;   // the chat gameState in memory actually belongs to
let pendingChatId = null;   // id handed to us by CHAT_CHANGED, before we (re)load
let stateReady = false;     // false while switching chats — nothing may be saved

// Single safe source for the event interval. Survives NaN/garbage in settings
// (an empty number input saves NaN, which used to kill the event system forever).
function evtRange() {
    const lo = Math.max(1, parseInt(settings.eventMinMessages) || 10);
    const hi = Math.max(lo + 1, parseInt(settings.eventMaxMessages) || 30);
    return { lo, hi };
}
function rollEventCounter() {
    const { lo, hi } = evtRange();
    return Math.floor(Math.random() * (hi - lo)) + lo;
}
function freshGameState() {
    const { lo, hi } = evtRange();
    return {
        inventory: [],
        coins: 0,
        messagesUntilEvent: Math.floor(Math.random() * (hi - lo)) + lo,
        activeEvent: null,
        activeDebuff: null,
        lootGenerated: false,
        forageQuests: []
    };
}
function cloneState(s) { try { return JSON.parse(JSON.stringify(s)); } catch (e) { return s; } }
function sanitizeState(s) {
    if (!s || typeof s !== 'object') return freshGameState();
    if (!Array.isArray(s.inventory)) s.inventory = [];
    if (!Array.isArray(s.forageQuests)) s.forageQuests = [];
    if (typeof s.coins !== 'number') s.coins = 0;
    const seen = new Set();               // drop duplicate ids
    s.inventory = s.inventory.filter(it => {
        if (!it || typeof it !== 'object' || !it.name) return false;
        if (!it.id) it.id = genId();
        if (seen.has(it.id)) return false;
        seen.add(it.id); return true;
    });
    return s;
}
// True while the loaded state still belongs to the active chat. Guards async work.
function ownsChat(id) { return !!(stateReady && id && currentChatId === id && getContext().chatId === id); }
// Other modules may call the bridge before CHAT_CHANGED has switched the state over.
function syncChat() {
    const id = pendingChatId || getContext().chatId;
    if (!id) return;
    if (!stateReady || id !== currentChatId) loadGameState(id);
}

// ============================================================
// INGREDIENT NAME MATCHING
// Generated item names vary in wording and inflection ("sulfur alloy" / "alloy of sulfur"),
// so a literal comparison rejects ingredients the player actually holds. Names are compared
// through a normalised, stemmed, order-independent key instead.
// ============================================================
const ING_STOP = new Set([
    'of', 'the', 'a', 'an', 'and', 'with', 'from', 'for',
    'из', 'для', 'и', 'с', 'со', 'на', 'в', 'от',
    // generic packaging / portion words that carry no identity
    'кусок', 'кусочек', 'обломок', 'осколок', 'щепотка', 'горсть', 'немного', 'штука', 'порция', 'пучок',
    'piece', 'chunk', 'bit', 'pinch', 'handful', 'portion', 'bunch', 'lump'
]);
const ING_GRAM = ['ического', 'ическая', 'ически', 'ами', 'ями', 'ого', 'ему', 'ому', 'ыми', 'ими', 'ies', 'ах', 'ях', 'ов', 'ев', 'ей', 'ой', 'ый', 'ий', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ым', 'им', 'ых', 'их', 'ом', 'ем', 'ую', 'юю', 'ся', 'es', 'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о', 'ь', 'й', 's'];
const ING_DERIV = ['ическ', 'енн', 'инн', 'ян', 'ан', 'ск', 'ов', 'ев', 'н'];
function ingCut(w, list) {
    for (const s of list) if (w.length - s.length >= 3 && w.endsWith(s)) return w.slice(0, -s.length);
    return w;
}
function ingStem(w) {
    if (w.length <= 3) return w;
    let x = ingCut(w, ING_GRAM);
    x = ingCut(x, ING_DERIV);
    x = ingCut(x, ING_GRAM);
    return x;
}
// "Sulfur alloy" and "alloy of sulfur (piece)" collapse to the same key.
function ingKey(name) {
    const words = String(name || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/\(.*?\)/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter(w => w && !ING_STOP.has(w))
        .map(ingStem)
        .filter(Boolean);
    if (!words.length) return String(name || '').trim().toLowerCase();
    return words.sort().join('|');
}
function sameIng(a, b) { return !!a && !!b && ingKey(a) === ingKey(b); }

// Unique item ID generator (avoids deletion bugs)
function genId() { return Math.random().toString(36).substr(2, 9); }

const ITEM_TYPES = ['weapon', 'armor', 'clothing', 'material', 'food', 'consumable', 'misc'];
function typeLabel(ty) { return t('tag_' + (ITEM_TYPES.includes(ty) ? ty : 'misc')); }
const TYPE_WEIGHT = { weapon: 1.5, armor: 8, clothing: 1, material: 0.5, food: 0.3, consumable: 0.2, misc: 0.5 };
function defaultWeight(type) { return (TYPE_WEIGHT[type] != null) ? TYPE_WEIGHT[type] : 0.5; }
function normItem(item, chance) {
    const type = ITEM_TYPES.includes(item.type) ? item.type : 'misc';
    const out = {
        id: genId(), name: item.name, desc: item.desc || '',
        chance: (typeof chance === 'number') ? chance : calculateChance(),
        type: type,
        weight: (typeof item.weight === 'number' && item.weight > 0) ? item.weight : defaultWeight(type)
    };
    if (typeof item.heal === 'number' && item.heal > 0) out.heal = item.heal;
    if (typeof item.food === 'number' && item.food > 0) out.food = item.food;
    if (item.buff && item.buff.name) out.buff = { name: String(item.buff.name), effect: String(item.buff.effect || ''), kind: item.buff.kind === 'debuff' ? 'debuff' : 'buff', duration: (typeof item.buff.duration === 'number' && item.buff.duration > 0) ? item.buff.duration : null };
    if (typeof item.dur === 'number') { out.dur = item.dur; out.max = (typeof item.max === 'number') ? item.max : item.dur; out.broken = !!item.broken; }
    if (typeof item.grade === 'number') out.grade = item.grade;
    if (typeof item.armor === 'number') out.armor = item.armor;
    if (typeof item.attack === 'number') out.attack = item.attack;
    if (typeof item.patchesLeft === 'number') out.patchesLeft = item.patchesLeft;
    return out;
}
function applyConsumable(item, eff) {
    let v = (window.RPG && window.RPG.vitals && window.RPG.vitals.available) ? window.RPG.vitals : null;
    if (v && typeof v.isEnabled === 'function' && !v.isEnabled()) v = null;
    const did = [];
    if (v) {
        let fed = 0;
        if (eff.food > 0 && typeof v.feed === 'function') fed = v.feed(eff.food) || 0;
        if (fed > 0) did.push(t('used_fed', { n: fed }));
        if (eff.heal > 0) { v.heal(eff.heal); did.push(t('used_heal', { n: eff.heal })); }
        if (eff.buff && eff.buff.name) { v.addBuff(eff.buff); did.push(t('used_buff', { name: eff.buff.name })); }
    }
    return did;
}
function announceUseInChat(name, did) {
    if (settings.announceUse === false) return;
    const ta = $('#send_textarea');
    if (!ta.length) return;
    const extra = (did && did.length) ? ` (${did.join(' ')})` : '';
    ta.val((ta.val() || '') + ` *${t('use_verb', { name })}${extra}* `).trigger('input');
}
async function useConsumable(item, index) {
    // fast path: the item already carries effect data
    if ((typeof item.heal === 'number' && item.heal > 0) || (typeof item.food === 'number' && item.food > 0) || (item.buff && item.buff.name) || item.type === 'food' || item.type === 'consumable') {
        const eff = {
            heal: (typeof item.heal === 'number') ? item.heal : 0,
            food: (typeof item.food === 'number') ? item.food : (item.type === 'food' ? 20 : 0),
            buff: (item.buff && item.buff.name) ? item.buff : null
        };
        if (item.type === 'food' && eff.food === 0 && eff.heal === 0) eff.heal = 15;
        const did = applyConsumable(item, eff);
        announceUseInChat(item.name, did);
        if (did.length) toastr.success(t('used', { name: item.name }) + ' ' + did.join(' '));
        else toastr.info(t('used', { name: item.name }));
        const i = gameState.inventory.findIndex(x => x.id === item.id);
        if (i >= 0) gameState.inventory.splice(i, 1);
        saveGameState(); updateInventoryGrid();
        return;
    }
    // otherwise ask the model whether it can be eaten/drunk and what it does
    if (!settings.apiKey) { toastr.warning(t('tc_err')); return; }
    const myChat = currentChatId;
    toastr.info(t('uc_checking'));
    try {
        const sys = `You decide whether an item could be EATEN or DRUNK by a person right now, and its effect.
Item: "${item.name}" (${item.desc || 'no description'}), type "${item.type || 'misc'}".
Only food, drink, medicine, potions, tonics and the like are consumable. A tool, weapon, coin or piece of clothing is NOT.
If consumable, give effects: "heal" (HP restored, 0-60), "food" (satiety restored, 0-50), and optionally a "buff" {"name","effect","duration" in turns}. Use what fits (bread feeds, a potion heals, a tonic buffs). Use 0 where not applicable.
Respond strictly JSON: {"is_consumable": true/false, "heal": 0, "food": 0, "buff": null, "reason": "<one short sentence in ${genLang()}>"}`;
        const res = await callAI(sys, 'Judge the item.');
        if (!ownsChat(myChat)) return;
        if (!res || !res.is_consumable) { toastr.warning(t('uc_no', { name: item.name, reason: (res && res.reason) || '' })); return; }
        const eff = {
            heal: Math.max(0, parseInt(res.heal) || 0),
            food: Math.max(0, parseInt(res.food) || 0),
            buff: (res.buff && res.buff.name) ? { name: String(res.buff.name), effect: String(res.buff.effect || ''), kind: 'buff', duration: (typeof res.buff.duration === 'number' && res.buff.duration > 0) ? res.buff.duration : null } : null
        };
        const did = applyConsumable(item, eff);
        announceUseInChat(item.name, did);
        toastr.success(t('used', { name: item.name }) + (did.length ? ' ' + did.join(' ') : '') + (res.reason ? ' ' + res.reason : ''));
        const i = gameState.inventory.findIndex(x => x.id === item.id);
        if (i >= 0) gameState.inventory.splice(i, 1);
        saveGameState(); updateInventoryGrid();
    } catch (e) { toastr.error(t('tc_err')); }
}
async function convertToCoins(item, index) {
    if (!settings.apiKey) { toastr.warning(t('tc_err')); return; }
    const myChat = currentChatId;
    toastr.info(t('tc_checking'));
    try {
        const sys = `You decide whether an item a player holds IS money — currency or a direct store of monetary value they could simply pocket as coins WITHOUT needing a buyer (coins, banknotes, a coin purse, loose gold/silver, gems, bullion, a valuable ring). A regular tool, weapon, food or piece of clothing is NOT money — those must be sold to a vendor, not converted.
Item: "${item.name}" (${item.desc || 'no description'}), type "${item.type || 'misc'}".
If it is money/valuables, give how many coins it becomes (be reasonable: a few loose coins ~1-15, a fat purse ~30-80, a gem ~20-120). If it is not money, set is_money false.
Respond strictly JSON: {"is_money": true/false, "coins": <integer>, "reason": "<one short sentence in ${genLang()}>"}`;
        const res = await callAI(sys, 'Judge the item.');
        if (!ownsChat(myChat)) return;
        if (res && res.is_money) {
            const n = Math.max(1, parseInt(res.coins) || 1);
            gameState.coins = Math.max(0, (gameState.coins || 0) + n);
            const idx = gameState.inventory.findIndex(i => i.id === item.id);
            if (idx >= 0) gameState.inventory.splice(idx, 1);
            saveGameState(); updateInventoryGrid();
            toastr.success(t('tc_yes', { name: item.name, n: n, reason: res.reason || '' }));
        } else {
            toastr.warning(t('tc_no', { name: item.name, reason: (res && res.reason) || '' }));
        }
    } catch (e) { toastr.error(t('tc_err')); }
}

function loadSettings() {
    if (!extension_settings[MODULE_NAME]) extension_settings[MODULE_NAME] = {};
    settings = Object.assign({}, defaultSettings, extension_settings[MODULE_NAME]);
    if (!settings.chatStates) settings.chatStates = {};
    if (!settings.chatStamps) settings.chatStamps = {};
    // heal NaN/garbage that older builds could have saved from empty inputs
    if (!Number.isFinite(settings.eventMinMessages)) settings.eventMinMessages = defaultSettings.eventMinMessages;
    if (!Number.isFinite(settings.eventMaxMessages)) settings.eventMaxMessages = defaultSettings.eventMaxMessages;
    if (!Number.isFinite(settings.injectDepth)) settings.injectDepth = defaultSettings.injectDepth;
    if (!Number.isFinite(settings.carryCapacity)) settings.carryCapacity = defaultSettings.carryCapacity;
}

// Old per-chat states used to live in settings forever, bloating settings.json.
// States untouched for STATE_TTL days are dropped; they are still recoverable
// from the rpg_inventory_checkpoint backup written into the chat itself.
const STATE_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
function pruneOldStates() {
    const now = Date.now();
    let changed = false;
    for (const id of Object.keys(settings.chatStates)) {
        if (!settings.chatStamps[id]) { settings.chatStamps[id] = now; changed = true; continue; } // migrate
        if (now - settings.chatStamps[id] > STATE_TTL_MS) {
            delete settings.chatStates[id];
            delete settings.chatStamps[id];
            changed = true;
        }
    }
    for (const id of Object.keys(settings.chatStamps)) {
        if (!settings.chatStates[id]) { delete settings.chatStamps[id]; changed = true; }
    }
    if (changed) saveSettings();
}

function saveSettings(immediate = true) {
    extension_settings[MODULE_NAME] = settings;
    // Discrete changes (buying, selling, taking loot, crafting…) flush to disk right away, so a quick
    // page reload can't lose coins or items (the debounced save can be ~1s late and get dropped on
    // refresh). High-frequency per-message writes pass immediate=false to stay debounced. Same pattern
    // as RPG-Equipment-Durability.
    if (immediate && typeof stSaveSettings === 'function') {
        try { const p = stSaveSettings(); if (p && typeof p.catch === 'function') p.catch(() => { }); return; }
        catch (e) { /* fall back to debounced below */ }
    }
    if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
}

function loadGameState(explicitId) {
    const context = getContext();
    const chatId = explicitId || pendingChatId || context.chatId;
    if (!chatId) {
        // No chat open: hold no state, so nothing can be written into the next chat.
        currentChatId = null; pendingChatId = null; stateReady = false;
        gameState = freshGameState();
        return;
    }

    // Claim the chat before anything can save, so a stale state cannot be written here.
    currentChatId = chatId; pendingChatId = null; stateReady = true;
    if (!settings.chatStamps) settings.chatStamps = {};
    settings.chatStamps[chatId] = Date.now();   // touch: keeps this chat's state from being pruned

    if (settings.chatStates[chatId]) {
        gameState = sanitizeState(settings.chatStates[chatId]);
        settings.chatStates[chatId] = gameState;
    } else {
        // Restore the backpack from the in-chat backup (group conversion, branching).
        // A chat holding only the greeting is not a copy of anything, so it is never restored
        // into: that guard keeps a fresh chat from inheriting a previous chat's backpack.
        const chat = context.chat;
        let restored = false;
        if (chat && chat.length > 1) {
            for (let i = chat.length - 1; i >= 0; i--) {
                const cp = chat[i].extra && chat[i].extra.rpg_inventory_checkpoint;
                if (cp) {
                    gameState = sanitizeState(cloneState(cp));   // copy: never share objects with the chat file
                    settings.chatStates[chatId] = gameState;
                    saveSettings();
                    restored = true;
                    toastr.success(t('toast_restore'));
                    break;
                }
            }
        }
        if (!restored) {
            gameState = freshGameState();
            settings.chatStates[chatId] = gameState;
        }
    }
    if (!gameState.lootGenerated && context.chat && context.chat.length > 0) {
        generateStartingLoot();
    }
    renderQuestPanelContent();
    updateContextInjection();
    restoreMagnifyingGlasses();
    updateInventoryGrid();
}

function saveGameState(immediate = true) {
    if (!stateReady || !currentChatId) return;                       // mid-switch: do not write
    const context = getContext();
    if (context.chatId && context.chatId !== currentChatId) return;  // state belongs to a chat we left
    settings.chatStates[currentChatId] = gameState;
    if (!settings.chatStamps) settings.chatStamps = {};
    settings.chatStamps[currentChatId] = Date.now();
    saveSettings(immediate);

    // Backup into the last message, as a copy rather than a live reference.
    const chat = context.chat;
    if (chat && chat.length > 0) {
        const lastMsg = chat[chat.length - 1];
        if (!lastMsg.extra) lastMsg.extra = {};
        lastMsg.extra.rpg_inventory_checkpoint = cloneState(gameState);
        saveChatDebounced();
    }
}
async function callAI(systemPrompt, userPrompt, maxTokens = 1200) {
    if (!settings.apiKey) throw new Error("API key is not set!");
    let endpointUrl = (settings.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '') + '/chat/completions';
    
    for (let i=0; i<2; i++) {
        try {
            const response = await fetch(endpointUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${settings.apiKey.trim()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: settings.model,
                    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                    temperature: settings.temperature,
                    // Without an explicit cap many providers (OpenRouter, free models) apply a tiny
                    // default and CUT the reply mid-sentence — that was the "events arrive truncated"
                    // bug, and a chopped JSON then failed to parse or came back empty.
                    max_tokens: maxTokens,
                    response_format: { type: "json_object" }
                })
            });
            if (response.status === 429 && i===0) { await new Promise(r=>setTimeout(r,2000)); continue; }
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            const finish = data.choices?.[0]?.finish_reason;
            let content = (data.choices?.[0]?.message?.content || '').trim();
            const parsed = parseLenientJSON(content);
            if (parsed === null) throw new Error(finish === 'length' ? 'reply truncated (raise max_tokens)' : 'bad JSON');
            return parsed;
        } catch(e) { if(i===1) throw e; }
    }
}

// Tolerates a reply that got cut off: closes dangling strings/braces so a truncated
// but mostly-complete event still yields usable data instead of throwing.
function parseLenientJSON(content) {
    if (!content) return null;
    const start = content.indexOf('{');
    if (start < 0) return null;
    let frag = content.slice(start);
    try { return JSON.parse(frag); } catch (e) { /* try to repair a truncated tail */ }
    // strip a trailing partial token, balance quotes and brackets
    let inStr = false, esc = false, depth = 0, lastSafe = -1;
    const stack = [];
    for (let k = 0; k < frag.length; k++) {
        const ch = frag[k];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; if (!inStr) lastSafe = k; continue; }
        if (inStr) continue;
        if (ch === '{' || ch === '[') { stack.push(ch === '{' ? '}' : ']'); depth++; }
        else if (ch === '}' || ch === ']') { stack.pop(); depth--; if (depth === 0) lastSafe = k; }
        else if (ch === ',' || /\s/.test(ch)) { if (depth > 0) lastSafe = k; }
    }
    let repaired = frag;
    if (inStr) repaired += '"';                       // close a dangling string
    repaired = repaired.replace(/,\s*$/, '');          // drop a trailing comma
    while (stack.length) repaired += stack.pop();     // close open braces/brackets
    try { return JSON.parse(repaired); } catch (e) { }
    // last resort: parse up to the last balanced point
    if (lastSafe > 0) {
        let head = frag.slice(0, lastSafe + 1);
        const st2 = [];
        let is2 = false, es2 = false;
        for (const ch of head) {
            if (es2) { es2 = false; continue; }
            if (ch === '\\') { es2 = true; continue; }
            if (ch === '"') { is2 = !is2; continue; }
            if (is2) continue;
            if (ch === '{' || ch === '[') st2.push(ch === '{' ? '}' : ']');
            else if (ch === '}' || ch === ']') st2.pop();
        }
        if (is2) head += '"';
        head = head.replace(/,\s*$/, '');
        while (st2.length) head += st2.pop();
        try { return JSON.parse(head); } catch (e) { }
    }
    return null;
}

function calculateChance() {
    const roll = Math.random();
    if (roll > 0.90) return Math.floor(Math.random() * 20) + 80; 
    if (roll > 0.60) return Math.floor(Math.random() * 30) + 50; 
    return Math.floor(Math.random() * 40) + 10; 
}

async function generateStartingLoot() {
    if (!settings.enabled || gameState.inventory.length > 0) return;
    const context = getContext();
    const myChat = currentChatId;                       // chat this loot is rolled for
    let lore = context.characterId !== undefined && characters[context.characterId] ? characters[context.characterId].description || "" : "";
    const firstMessage = context.chat[0]?.mes || "";

    try {
        const sysPrompt = `You are a Game Master. Generate 3 basic starting items for the player.
CRITICAL RULES:
1. The items MUST perfectly fit the setting and time period (based on lore/story).
2. To encourage crafting, make 1 or 2 of the items "broken", "damaged", or "empty" (e.g., "Broken knife", "Dead flashlight").
3. ALL item names and descriptions MUST be in ${genLang()}.
4. Give each item a "type" (weapon, armor, clothing, material, food, consumable, misc) and a REALISTIC "weight" in kg for that exact real object (a coin ~0.01, a dagger ~0.4, a sword ~1.5, an iron poker/crowbar ~2-3, a thick coat ~2, plate armor ~10-20). Never default everything to 1 — weigh each object realistically.
5. For "food" items add a "food" number (satiety restored, ~10-40). For "food"/"consumable" you MAY also add "heal" (HP restored) and/or a "buff": {"name":"","effect":"","duration":turns}. Use what fits (bread feeds, a potion heals, a stimulant buffs).

Lore Context: ${lore.substring(0, 500)}
Story Start: ${firstMessage.substring(0, 500)}

Output strictly JSON: {"items": [{"name": "Name", "desc": "Description", "type": "misc", "weight": 1}]}`;

        const result = await callAI(sysPrompt, `Give me 3 starting items in ${genLang()}.`, 1500);
        if (!ownsChat(myChat)) return;                  // chat changed during the request
        (Array.isArray(result.items) ? result.items : []).forEach(item => {
            const nm = aiName(item && item.name);
            if (!nm) return;                          // skip junk entries from the model
            item.name = nm;
            gameState.inventory.push(normItem(item));
        });
        
        gameState.lootGenerated = true;
        saveGameState();
        toastr.success(t('toast_starting'));
        updateInventoryGrid();
    } catch (e) {}
}

// MAGNIFIER
function addMagnifyingGlass() {
    if (!settings.enabled) return;
    $('.mes').each(function() {
        const mesId = $(this).attr('mesid');
        const msg = getContext().chat[mesId];
        if (!msg || msg.is_user || msg.is_system) return;

        let scanCount = msg.extra?.rpg_scans || 0;
        if ($(this).find('.rpg-loot-btn').length === 0) {
            const btn = $(`<div class="rpg-loot-btn ${scanCount >= 1 ? 'exhausted' : ''}" title="${t('btn_search')}"><i class="fa-solid fa-magnifying-glass"></i></div>`);
            btn.on('click', async () => {
                if (scanCount >= 1) { toastr.warning(t('toast_nothing_here')); return; }
                if (btn.hasClass('busy')) return;          // ignore double-clicks mid-search
                btn.addClass('busy');
                toastr.info(t('toast_searching'));
                const ok = await scanMessageForLoot(msg.mes);
                btn.removeClass('busy');
                if (ok) {                                   // only spend the search if it actually ran
                    scanCount++;
                    if (!msg.extra) msg.extra = {};
                    msg.extra.rpg_scans = scanCount;
                    saveChatDebounced();
                    btn.addClass('exhausted'); btn.off('click');
                }
            });
            $(this).find('.mes_buttons').prepend(btn);
        }
    });
}

function restoreMagnifyingGlasses() { $('.rpg-loot-btn').remove(); addMagnifyingGlass(); }

async function scanMessageForLoot(messageText) {
    const myChat = currentChatId;
    try {
        const owned = (gameState.inventory || []).map(i => i.name).filter(Boolean);
        const ownedList = owned.length ? owned.slice(0, 80).join(', ') : '—';
        const hunted = forageNeededNames();
        // Give the model the exact wording of the hunted ingredients; left unconstrained it
        // returns near-synonyms that no longer line up with the recipes.
        const huntBlock = hunted.length
            ? `\nThe player is currently hunting these ingredients: ${hunted.join(', ')}.\nIf an item you find is essentially one of them, you MUST copy that name CHARACTER FOR CHARACTER — do not rephrase, re-order or re-decline it.`
            : '';
        const sysPrompt = `Analyze the provided text. Find 1 or 2 small, logical items the player could pick up. 
Some items can be broken, dirty, or damaged to encourage crafting. 
Do NOT make up impossible items. All names and descriptions MUST be in ${genLang()}. If nothing logical exists, return an empty array.
IMPORTANT: Do NOT offer items the player ALREADY HAS or has already picked up — avoid duplicates of the owned items listed below (skip anything with the same or an obviously equivalent name).${huntBlock}
Give each item a "type" (weapon, armor, clothing, material, food, consumable, misc) and a REALISTIC "weight" in kg for the real object (a coin ~0.01, a knife ~0.3, an iron poker ~2-3, armor ~10+). Do not just use 1 for everything.
Output JSON: {"items": [{"name": "Item name", "desc": "Description", "type": "misc", "weight": 1}]}`;
        const result = await callAI(sysPrompt, `Items the player ALREADY OWNS (do not offer these again): ${ownedList}\n\nMessage:\n${messageText}`, 1200);
        if (!ownsChat(myChat)) return false;            // chat changed during the request
        let items = Array.isArray(result.items) ? result.items : [];
        // If a hunted ingredient still came back reworded, snap it to its catalogued spelling.
        items.forEach(it => { if (it && it.name) { const c = forageCanonName(it.name); if (c) it.name = c; } });
        // Drop anything already owned (matched tolerantly, not literally).
        const ownedKeys = new Set(owned.map(ingKey));
        // junk names ("-1", bare numbers) never make it into the backpack
        items = items.filter(it => { if (!it) return false; const n = aiName(it.name); if (!n) return false; it.name = n; return true; });
        items = items.filter(it => !ownedKeys.has(ingKey(it.name)));
        if (items.length === 0) { toastr.info(t('toast_found_nothing')); return true; }
        // BONUS layer: the loupe still finds normal loot above — here it may ALSO turn up one
        // ingredient you're currently hunting (biased by the room/scene). Never replaces normal loot.
        try {
            const forg = rollForageIngredient(messageText);
            if (forg && !items.some(it => sameIng(it.name, forg.name))) items.push(forg);
        } catch (e) { /* ignore */ }
        showLootPopup(items);
        return true;
    } catch (e) { console.error('Loot scan error:', e); toastr.error(t('toast_search_err')); return false; }
}

// remove a finished/again-unwanted forage quest
function removeForageQuest(id) { gameState.forageQuests = (gameState.forageQuests || []).filter(q => q.id !== id); saveGameState(); }

// ---- forage helpers (name comparisons go through ingKey) ----
function forageNeededNames() {
    const out = [];
    (gameState.forageQuests || []).forEach(q => (q.ingredients || []).forEach(i => { if (!i.got) out.push(i.name); }));
    return out;
}
// Returns the catalogued spelling of a hunted ingredient matching `name`, or null.
function forageCanonName(name) {
    if (!name) return null;
    const k = ingKey(name);
    let hit = null;
    (gameState.forageQuests || []).forEach(q => (q.ingredients || []).forEach(i => {
        if (!hit && !i.got && ingKey(i.name) === k) hit = i.name;
    }));
    return hit;
}
// Marks a hunted ingredient as obtained. Called once the item is actually taken.
function markForageFound(name) {
    const k = ingKey(name);
    let changed = false;
    (gameState.forageQuests || []).forEach(q => (q.ingredients || []).forEach(i => {
        if (!i.got && ingKey(i.name) === k) { i.got = true; changed = true; }
    }));
    if (changed) {
        gameState.forageQuests = (gameState.forageQuests || []).filter(q => (q.ingredients || []).some(i => !i.got));
        saveGameState();
    }
    return changed;
}

// Roll whether THIS scan turns up a needed ingredient. Returns a loot item or null.
// With the map on, being in (or the scene naming) the ingredient's room greatly raises the odds;
// with no map, it falls back to base skill chance + whether the scene names the ingredient.
function rollForageIngredient(messageText) {
    const quests = gameState.forageQuests || [];
    if (!quests.length) return null;
    const pending = [];
    quests.forEach(q => (q.ingredients || []).forEach(ing => { if (!ing.got) pending.push({ q, ing }); }));
    if (!pending.length) return null;
    const map = (window.RPG && window.RPG.map && window.RPG.map.available && window.RPG.map.isEnabled()) ? window.RPG.map : null;
    const cur = map ? map.getCurrent() : null;
    const txt = String(messageText || '').toLowerCase();
    let best = null, bestChance = -1;
    pending.forEach(p => {
        let chance = p.q.chance || 25;
        const rk = String(p.ing.roomKey || '').toLowerCase();
        if (rk) {
            if (cur && cur.room && cur.room.toLowerCase() === rk) chance += 45;   // standing in the right room
            else if (txt.includes(rk)) chance += 22;                              // the scene names the room
            else chance = Math.max(6, chance - 18);                               // wrong place → slim
        }
        if (p.ing.name && txt.includes(String(p.ing.name).toLowerCase())) chance += 30; // scene names the item itself
        if (chance > bestChance) { bestChance = chance; best = p; }
    });
    if (!best) return null;
    if (Math.random() * 100 >= Math.min(92, bestChance)) return null; // this scan missed
    // The ingredient is not ticked off here: it counts only once taken from the loot popup
    // (see showLootPopup), so declining the find does not consume it.
    return { name: best.ing.name, desc: best.ing.desc || t('forage_found_desc'), type: 'material', weight: 0.2 };
}

function showLootPopup(items) {
    let popup = $('#rpg-loot-popup');
    if (popup.length === 0) {
        $('body').append(`<div id="rpg-loot-popup">
            <h3><i class="fa-solid fa-box-open"></i> ${t('loot_found')}</h3>
            <div class="rpg-loot-items" id="rpg-loot-list"></div>
            <button id="rpg-loot-take" style="background:#2e7d32; color:white; padding:8px; border:none; border-radius:4px; cursor:pointer; margin-right:10px;">${t('take_selected')}</button>
            <button id="rpg-loot-leave" style="background:#c62828; color:white; padding:8px; border:none; border-radius:4px; cursor:pointer;">${t('leave')}</button>
        </div>`);
        popup = $('#rpg-loot-popup');
    }
    let html = '';
    const generatedItems = [];
    items.forEach((item, i) => {
        const chance = calculateChance();
        generatedItems.push(normItem(item, chance));
        html += `<div class="rpg-loot-card selected" data-idx="${i}">
            <span class="rpg-loot-check"><i class="fa-solid fa-check"></i></span>
            <span class="rpg-item-name">${escapeHtml(item.name)}</span>
            <span class="rpg-item-chance">${chance}%</span>
        </div>`;
    });
    $('#rpg-loot-list').html(html);
    popup.fadeIn();

    // tap a card to include/exclude it
    $('#rpg-loot-list .rpg-loot-card').off('click').on('click', function () { $(this).toggleClass('selected'); });

    const myChat = currentChatId;
    $('#rpg-loot-take').off('click').on('click', () => {
        if (!ownsChat(myChat)) { popup.fadeOut(); return; }   // loot belongs to the chat it was found in
        const chosen = [];
        $('#rpg-loot-list .rpg-loot-card.selected').each(function () { chosen.push(generatedItems[parseInt($(this).data('idx'))]); });
        if (chosen.length === 0) { popup.fadeOut(); return; }
        gameState.inventory.push(...chosen);
        chosen.forEach(it => markForageFound(it.name));   // tick off any hunt this satisfies
        saveGameState(); updateInventoryGrid(); popup.fadeOut(); toastr.success(t('toast_items_added'));
    });
    $('#rpg-loot-leave').off('click').on('click', () => popup.fadeOut());
}

// UI & CRAFTING
function renderMainUI() {
    let container = $('#rpg-buttons-container');
    if (container.length === 0) {
        container = $('<div id="rpg-buttons-container" style="position:fixed; bottom:20px; right:20px; display:flex; gap:15px; z-index:3000;"></div>');
        $('body').append(container);
    }
    
    if ($('#rpg-inventory-btn').length === 0) {
        container.append(`
            <div class="rpg-floating-btn" id="rpg-quest-toggle-btn" title="${t('btn_quests')}" style="position:relative; width:50px; height:50px; margin:0; display:flex;">
                <i class="fa-solid fa-clipboard-question"></i><div class="rpg-quest-badge" id="rpg-quest-badge"></div>
            </div>
            <div class="rpg-floating-btn" id="rpg-inventory-btn" title="${t('btn_backpack')}" style="position:static; width:50px; height:50px; margin:0; display:flex;"><i class="fa-solid fa-suitcase"></i></div>
        `);
    }

    if ($('#rpg-inventory-modal').length === 0) {
        $('body').append(`
            <div class="rpg-modal" id="rpg-inventory-modal">
                <div class="rpg-modal-header" id="rpg-inv-drag"><span><i class="fa-solid fa-suitcase"></i> ${t('inv_title')}</span> <i class="fa-solid fa-xmark rpg-modal-close"></i></div>
                <div class="rpg-inv-body">
                    <div class="rpg-items-grid" id="rpg-inv-grid"></div>
                    <div class="rpg-craft-zone">
                        <div class="rpg-craft-title"><i class="fa-solid fa-hammer"></i> ${t('workbench')}</div>
                        <div class="rpg-craft-slot" id="rpg-slot-base" title="${t('click_to_remove')}">${t('slot_base')}</div>
                        <div class="rpg-craft-plus"><i class="fa-solid fa-plus"></i></div>
                        <div class="rpg-craft-slot" id="rpg-slot-mat" title="${t('click_to_remove')}">${t('slot_material')}</div>
                        <button class="rpg-craft-btn" id="rpg-craft-action" disabled>${t('upgrade_item')}</button>
                    </div>
                </div>
            </div>

            <div class="rpg-modal" id="rpg-quest-modal">
                <div class="rpg-modal-header" id="rpg-quest-drag"><span><i class="fa-solid fa-envelope-open-text"></i> ${t('letter')}</span> <i class="fa-solid fa-xmark rpg-modal-close"></i></div>
                <div class="rpg-quest-body" id="rpg-quest-content"></div>
            </div>
        `);
        makeModalDraggable(document.getElementById('rpg-inventory-modal'), document.getElementById('rpg-inv-drag'));
        makeModalDraggable(document.getElementById('rpg-quest-modal'), document.getElementById('rpg-quest-drag'));
        window.addEventListener('resize', () => { if ($('#rpg-quest-modal').hasClass('visible')) fitLetter(); });
        // drag an item from the grid straight onto a workbench slot (click / Shift+click still work)
        [['#rpg-slot-base', 'base'], ['#rpg-slot-mat', 'mat']].forEach(([sel, which]) => {
            const el = document.querySelector(sel); if (!el) return;
            el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop-hover'); });
            el.addEventListener('dragleave', () => el.classList.remove('drop-hover'));
            el.addEventListener('drop', (e) => {
                e.preventDefault(); el.classList.remove('drop-hover');
                const id = e.dataTransfer.getData('text/plain'); if (!id) return;
                const item = (gameState.inventory || []).find(i => i.id === id); if (!item) return;
                if (which === 'base') { craftSlotBase = item; if (craftSlotMaterial && craftSlotMaterial.id === item.id) craftSlotMaterial = null; }
                else { if (craftSlotBase && craftSlotBase.id === item.id) return; craftSlotMaterial = item; }
                updateCraftZone();
            });
        });
    }

    if (!settings.enabled) { 
        $('#rpg-inventory-btn').hide(); 
        $('#rpg-quest-toggle-btn').hide(); 
        return; 
    } else { 
        $('#rpg-inventory-btn').show(); 
        $('#rpg-quest-toggle-btn').show(); 
    }

    $('#rpg-inventory-btn').off('click').on('click', () => { updateInventoryGrid(); $('#rpg-inventory-modal').toggleClass('visible'); });
    $('#rpg-quest-toggle-btn').off('click').on('click', () => { renderQuestPanelContent(); $('#rpg-quest-modal').toggleClass('visible'); $('#rpg-quest-badge').removeClass('active'); });
    // Delegated + namespaced, and scoped to OUR modals only: a blanket
    // $('.rpg-modal-close').off('click') here used to strip the Map extension's
    // close handlers too (and vice versa) — they only worked by luck.
    $(document).off('click.rpgEngineClose').on('click.rpgEngineClose', '#rpg-inventory-modal .rpg-modal-close, #rpg-quest-modal .rpg-modal-close', function() { $(this).closest('.rpg-modal').removeClass('visible'); });
    $('#rpg-craft-action').off('click').on('click', processCraft);
    $('#rpg-slot-base').off('click').on('click', () => { craftSlotBase = null; updateCraftZone(); });
    $('#rpg-slot-mat').off('click').on('click', () => { craftSlotMaterial = null; updateCraftZone(); });
}

function makeModalDraggable(elmnt, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    handle.onmousedown = (e) => {
        if (e.target.closest('.rpg-modal-close, .dsp-close, button, input, select, a, .rpg-item-eat, .rpg-item-tocoins, .rpg-item-delete')) return;
        e.preventDefault(); pos3 = e.clientX; pos4 = e.clientY;
        document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
        document.onmousemove = (ev) => {
            ev.preventDefault(); pos1 = pos3 - ev.clientX; pos2 = pos4 - ev.clientY; pos3 = ev.clientX; pos4 = ev.clientY;
            elmnt.style.top = (elmnt.offsetTop - pos2) + "px"; elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
        };
    };
}

function updateInventoryGrid() {
    const grid = $('#rpg-inv-grid');
    grid.empty();
    const totalW = gameState.inventory.reduce((sum, i) => sum + ((typeof i.weight === 'number') ? i.weight : 1), 0);
    const cap = settings.carryCapacity || 50;
    const gm = !!settings.gmMode;
    const coinsEditor = gm ? `<input type="number" class="text_pole rpg-coins-in" value="10" min="1"><i class="fa-solid fa-plus rpg-coins-add" title="${escapeHtml(t('coins_add'))}"></i><i class="fa-solid fa-minus rpg-coins-sub" title="${escapeHtml(t('coins_sub'))}"></i>` : '';
    const head = $(`<div class="rpg-inv-head">
        <span class="rpg-coins-ctrl"><i class="fa-solid fa-coins"></i> <b>${gameState.coins || 0}</b> ${coinsEditor}</span>
        <span class="${totalW > cap ? 'over' : ''}"><i class="fa-solid fa-weight-hanging"></i> ${Math.round(totalW * 10) / 10} / ${cap}</span>
    </div>`);
    if (gm) {
        head.find('.rpg-coins-add').on('click', () => { const n = parseInt(head.find('.rpg-coins-in').val()) || 0; gameState.coins = Math.max(0, (gameState.coins || 0) + n); saveGameState(); updateInventoryGrid(); });
        head.find('.rpg-coins-sub').on('click', () => { const n = parseInt(head.find('.rpg-coins-in').val()) || 0; gameState.coins = Math.max(0, (gameState.coins || 0) - n); saveGameState(); updateInventoryGrid(); });
    }
    grid.append(head);
    
    gameState.inventory.forEach((item, index) => {
        const card = $(`<div class="rpg-item-card" data-id="${item.id}" draggable="true" title="${t('card_title')}">
                <i class="fa-solid fa-trash rpg-item-delete" title="${t('discard')}"></i>
                <span class="rpg-item-name">${escapeHtml(item.name)}</span>
                <span class="rpg-item-desc">${escapeHtml(item.desc)}</span>
                <span class="rpg-item-chance">${t('item_success', {chance: item.chance})}</span>
                <span class="rpg-item-tag rpg-tag-${item.type || 'misc'}">${escapeHtml(typeLabel(item.type))}${(typeof item.weight === 'number') ? ` · ⚖${item.weight}` : ''}</span>
                <i class="fa-solid fa-mug-hot rpg-item-eat" title="${escapeHtml(t('use_item'))}"></i>
                <i class="fa-solid fa-coins rpg-item-tocoins" title="${escapeHtml(t('to_coins'))}"></i>
            </div>`);
        card[0].addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'copy'; card.addClass('dragging'); });
        card[0].addEventListener('dragend', () => card.removeClass('dragging'));
        card.find('.rpg-item-tocoins').on('click', (e) => { e.stopPropagation(); convertToCoins(item, index); });
        card.find('.rpg-item-eat').on('click', (e) => { e.stopPropagation(); useConsumable(item, index); });

        card.find('.rpg-item-delete').on('click', (e) => {
            e.stopPropagation(); gameState.inventory.splice(index, 1); saveGameState(); updateInventoryGrid();
        });

        card.on('click', (e) => {
            if (e.shiftKey) {
                if (!craftSlotBase) craftSlotBase = item; 
                else if (!craftSlotMaterial && item.id !== craftSlotBase.id) craftSlotMaterial = item;
                updateCraftZone();
            } else {
                useItemInChat(item);
                $('#rpg-inventory-modal').removeClass('visible');
            }
        });
        grid.append(card);
    });
}

function updateCraftZone() {
    if (craftSlotBase) $('#rpg-slot-base').addClass('filled').html(`<b>${escapeHtml(craftSlotBase.name)}</b><br>${craftSlotBase.chance}%<br><span style="font-size:10px; color:#ff5252">${t('click_remove')}</span>`);
    else $('#rpg-slot-base').removeClass('filled').html(t('slot_hint_base'));
    
    if (craftSlotMaterial) $('#rpg-slot-mat').addClass('filled').html(`<b>${escapeHtml(craftSlotMaterial.name)}</b><br>${craftSlotMaterial.chance}%<br><span style="font-size:10px; color:#ff5252">${t('click_remove')}</span>`);
    else $('#rpg-slot-mat').removeClass('filled').html(t('slot_hint_material'));
    
    $('#rpg-craft-action').prop('disabled', !(craftSlotBase && craftSlotMaterial));
}

async function processCraft() {
    if (!craftSlotBase || !craftSlotMaterial) return;
    const myChat = currentChatId;
    $('#rpg-craft-action').prop('disabled', true).text(t('ai_analysis'));

    try {
        const sysPrompt = `You are a realistic game logic arbiter. The player is crafting/combining items.
Base Item: "${craftSlotBase.name}" (${craftSlotBase.desc})
Material to apply: "${craftSlotMaterial.name}" (${craftSlotMaterial.desc})

Determine if combining these makes logical sense in reality.
If it IS logical, invent a new name and description for the Base Item to reflect the upgrade/repair. All output MUST be in ${genLang()}.
Output strictly JSON: 
{ "logical": true/false, "reason": "Short explanation", "newName": "New improved name", "newDesc": "New description" }`;

        const result = await callAI(sysPrompt, "Is this craft logical? Provide new name and desc.", 900);
        if (!ownsChat(myChat)) { craftSlotBase = null; craftSlotMaterial = null; updateCraftZone(); $('#rpg-craft-action').text(t('upgrade_item')); return; }

        if (!result.logical) {
            toastr.error(t('toast_craft_impossible', {reason: result.reason}));
            $('#rpg-craft-action').prop('disabled', false).text(t('upgrade_item'));
            return;
        }

        const roll = Math.random() * 100;
        if (roll <= craftSlotMaterial.chance) {
            craftSlotBase.name = result.newName || craftSlotBase.name;
            craftSlotBase.desc = result.newDesc || craftSlotBase.desc;
            const boost = Math.floor(Math.random() * 15) + 5; 
            craftSlotBase.chance = Math.min(100, craftSlotBase.chance + boost);
            toastr.success(t('toast_craft_ok', {name: craftSlotBase.name, chance: craftSlotBase.chance}));
        } else {
            const penalty = Math.floor(Math.random() * 7) + 2;
            craftSlotBase.chance = Math.max(5, craftSlotBase.chance - penalty);
            toastr.error(t('toast_craft_fail', {chance: craftSlotBase.chance}));
        }

        gameState.inventory = gameState.inventory.filter(i => i.id !== craftSlotMaterial.id);
        craftSlotBase = null; craftSlotMaterial = null;
        updateCraftZone();
        $('#rpg-craft-action').text(t('upgrade_item'));
        saveGameState(); updateInventoryGrid();
    } catch(e) { toastr.error(t('toast_craft_err')); $('#rpg-craft-action').prop('disabled', false).text(t('upgrade_item')); }
}

function useItemInChat(item) {
    const textarea = $('#send_textarea');
    let text = textarea.val();
    text += ` *Uses: ${item.name}* [RPG_ITEM_ROLL:${item.id}] `;
    textarea.val(text).trigger('input');
}

// === REMOVING ITEMS FROM INVENTORY ===
eventSource.on(event_types.MESSAGE_SENT, (messageId) => {
    if (!settings.enabled) return;
    syncChat();   // item rolls must resolve against the chat the message was sent in
    const msg = getContext().chat[messageId];
    if (!msg || !msg.is_user) return;

    // IMPORTANT: use string IDs (letters+digits)
    const rollRegex = /\[RPG_ITEM_ROLL:([a-zA-Z0-9]+)\]/g;
    let match;
    let modifiedText = msg.mes;
    let usedItems = [];

    while ((match = rollRegex.exec(msg.mes)) !== null) {
        const itemId = match[1];
        const itemIndex = gameState.inventory.findIndex(i => i.id === itemId);
        if (itemIndex !== -1) {
            const item = gameState.inventory[itemIndex];
            const isSuccess = (Math.random() * 100) <= item.chance;
            const resultText = isSuccess ? 
                `\n[The player successfully used the item "${item.name}". Describe the positive consequences for the player.]` : 
                `\n[The player tried to use "${item.name}" but FAILED. Describe the negative consequences or a counter-attack.]`;
            modifiedText = modifiedText.replace(match[0], resultText);
            usedItems.push(item.id); 
        } else {
            modifiedText = modifiedText.replace(match[0], ''); 
        }
    }

    if (modifiedText !== msg.mes) {
        msg.mes = modifiedText;
        if (usedItems.length > 0) {
            // Remove items from inventory PERMANENTLY
            gameState.inventory = gameState.inventory.filter(i => !usedItems.includes(i.id));
        }
        saveChatDebounced(); 
        saveGameState(); 
        updateInventoryGrid();
    }
});

// === EVENT SYSTEM (PLAYER-FOCUSED) ===
async function checkEventTrigger() {
    if (!settings.enabled) return;
    syncChat();                       // make sure we count against the chat that is actually open
    if (gameState.activeEvent) return;

    // self-heal: empty/broken counter or above the new max -> recompute by the current interval
    if (!Number.isFinite(gameState.messagesUntilEvent) || gameState.messagesUntilEvent > evtRange().hi) {
        gameState.messagesUntilEvent = rollEventCounter();
    }

    gameState.messagesUntilEvent--;
    if (gameState.messagesUntilEvent <= 0) {
        await generateRandomEvent();
    }
    saveGameState(false);   // fires every message — keep it debounced, don't hammer the server
}

async function generateRandomEvent() {
    const myChat = currentChatId;
    try {
        const context = getContext();
        const chat = context.chat;
        const recentHistory = chat.slice(-10).map(m => `${m.name}: ${m.mes}`).join('\n\n');

        // Event must target the PLAYER!
        const sysPrompt = `You are a Game Master. Based on the recent story, create a short, unexpected, but highly logical random EVENT or QUEST.
CRITICAL RULE: The event MUST directly target the PLAYER (user). It must present a problem, challenge, or choice specifically for the player to solve. Do NOT just describe the AI character doing things. Write the title and description in ${genLang()}.
Output strictly JSON:
{
  "title": "Event title",
  "desc": "Detailed description of what suddenly happened to the PLAYER so they can react in chat.",
  "reward_item": {"name": "Reward name", "desc": "Reward description"}
}`;
        
        const result = await callAI(sysPrompt, `History:\n${recentHistory}`, 1600);
        if (!ownsChat(myChat)) return;

        const title = aiName(result && result.title, null, 80);
        const desc = aiName(result && result.desc, null, 600);
        if (!title || !desc) { // empty OR junk ("-1", numbers) — don't show a broken card, retry soon
            gameState.messagesUntilEvent = 2; saveGameState();
            return;
        }
        const rw = result.reward_item;
        const rwName = rw ? aiName(rw.name, null, 50) : null;
        gameState.activeEvent = {
            title,
            desc,
            reward: rwName ? { name: rwName, desc: aiName(rw.desc, '', 140) || '' } : null,
            status: 'new'
        };

        gameState.messagesUntilEvent = rollEventCounter();
        saveGameState(); renderQuestPanelContent();
        $('#rpg-quest-badge').addClass('active'); toastr.info(t('toast_new_event'));
    } catch(e) {
        console.error('[RPG Engine] Event generation error:', e);
        toastr.error(t('toast_event_err'));
        gameState.messagesUntilEvent = 3; // do not spam: retry in a couple of messages
        saveGameState();
    }
}

function waxSealSvg() {
    return `<svg class="rpg-wax-svg" viewBox="0 0 100 126" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="wax seal">
        <defs>
            <radialGradient id="rpgWaxG" cx="38%" cy="30%" r="78%">
                <stop offset="0%" stop-color="#dc6155"/><stop offset="45%" stop-color="#b3413a"/><stop offset="100%" stop-color="#6c1d19"/>
            </radialGradient>
            <linearGradient id="rpgRibG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#8f2a24"/><stop offset="100%" stop-color="#5d1613"/>
            </linearGradient>
            <filter id="rpgWaxEdge"><feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="2" seed="11" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="5"/></filter>
        </defs>
        <g class="rpg-wax-rib"><path d="M40 62 L28 114 L41 105 L50 117 L49 66 Z" fill="url(#rpgRibG)"/><path d="M60 62 L72 114 L59 105 L50 117 L51 66 Z" fill="url(#rpgRibG)"/></g>
        <g filter="url(#rpgWaxEdge)"><circle cx="50" cy="48" r="33" fill="#591815"/><circle cx="50" cy="48" r="31" fill="url(#rpgWaxG)"/></g>
        <ellipse cx="40" cy="35" rx="11" ry="7" fill="rgba(255,196,178,0.28)"/>
        <circle cx="50" cy="48" r="25" fill="none" stroke="rgba(66,14,12,0.55)" stroke-width="2"/>
        <circle cx="50" cy="48" r="28.5" fill="none" stroke="rgba(60,14,12,0.5)" stroke-width="2.6" stroke-dasharray="1.6 3.5"/>
        <path transform="translate(50,48)" d="M0,-15 L4.3,-4.6 L15.2,-4.6 L6.5,2.2 L9.5,12.8 L0,6.4 L-9.5,12.8 L-6.5,2.2 L-15.2,-4.6 L-4.3,-4.6 Z"
            fill="#7a221d" stroke="rgba(255,196,176,0.4)" stroke-width="0.8" stroke-linejoin="round"/>
    </svg>`;
}
function dispatchSealSvg() {
    return `<svg class="dsp-seal" viewBox="0 0 70 96" xmlns="http://www.w3.org/2000/svg">
        <path d="M26 52 L20 92 L30 80 L35 92 L40 80 L50 92 L44 52 Z" fill="#8a1f15"/>
        <circle cx="35" cy="34" r="30" fill="none" stroke="#7a1a12" stroke-width="7" stroke-dasharray="2.5 4.5"/>
        <circle cx="35" cy="34" r="27" fill="#a82a1e"/>
        <circle cx="35" cy="34" r="27" fill="none" stroke="#6f160d" stroke-width="2"/>
        <circle cx="35" cy="34" r="19" fill="none" stroke="#cf5142" stroke-width="1.5" opacity=".7"/>
        <path d="M35 18 l4.6 9.6 10.4 1.3 -7.7 7.2 2 10.3 -9.3-5.1 -9.3 5.1 2-10.3 -7.7-7.2 10.4-1.3Z" fill="#f0d9a0"/>
    </svg>`;
}
function dispatchClosedSealSvg() {
    return `<svg class="dsp-seal-c" viewBox="0 0 70 70" xmlns="http://www.w3.org/2000/svg">
        <circle cx="35" cy="35" r="30" fill="none" stroke="#7a1a12" stroke-width="7" stroke-dasharray="2.5 4.5"/>
        <circle cx="35" cy="35" r="27" fill="#a82a1e"/>
        <circle cx="35" cy="35" r="27" fill="none" stroke="#6f160d" stroke-width="2"/>
        <path d="M35 19 l4.6 9.6 10.4 1.3 -7.7 7.2 2 10.3 -9.3-5.1 -9.3 5.1 2-10.3 -7.7-7.2 10.4-1.3Z" fill="#f0d9a0"/>
    </svg>`;
}

function renderQuestPanelContent() {
    const content = $('#rpg-quest-content');
    if (content.length === 0) return;

    const FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h6l2 2h10v10H3z"/></svg>';
    const CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    const GIFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 9h16v11H4zM4 9l1-4h14l1 4M12 5v15"/></svg>';
    const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    const XC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/></svg>';
    const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>';
    const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h13M11 6l6 6-6 6M20 5v14"/></svg>';

    if (!gameState.activeEvent) {
        content.html(`<div class="dsp-fit"><div class="dsp dsp-empty">
            <div class="dsp-empty-card">
                <div class="dsp-empty-stamp">${escapeHtml(t('no_mail'))}</div>
                <div class="dsp-env-closed">${dispatchClosedSealSvg()}</div>
                <h2>${escapeHtml(t('q_quiet_h'))}</h2>
                <p>${escapeHtml(t('q_quiet_p'))}</p>
            </div>
        </div></div>`);
        fitLetter();
        const emptyDrag = content.find('.dsp-empty-card')[0];
        if (emptyDrag) makeModalDraggable(document.getElementById('rpg-quest-modal'), emptyDrag);
        return;
    }

    const e = gameState.activeEvent;
    const isNew = e.status === 'new';
    const descHtml = String(e.desc || '').split(/\n\s*\n/).map(p => `<p>${escapeHtml(p.trim())}</p>`).join('') || `<p>${escapeHtml(e.desc || '')}</p>`;
    const rewardName = e.reward ? escapeHtml(e.reward.name) : escapeHtml(t('experience'));
    const badge = isNew
        ? `<div class="dsp-badge">${FOLDER}${escapeHtml(t('new_case'))}</div>`
        : `<div class="dsp-badge prog">${CLOCK}${escapeHtml(t('in_progress'))}</div>`;
    const actions = isNew
        ? `<button class="dsp-btn dsp-accept" id="rpg-q-accept">${PLAY}${escapeHtml(t('accept'))}</button>
           <button class="dsp-btn dsp-ignore" id="rpg-q-reject">${XC}${escapeHtml(t('ignore'))}</button>`
        : `<button class="dsp-btn dsp-accept" id="rpg-q-win">${CHECK}${escapeHtml(t('complete'))}</button>
           <button class="dsp-btn dsp-ignore" id="rpg-q-fail">${XC}${escapeHtml(t('fail'))}</button>`;

    content.html(`<div class="dsp-fit"><div class="dsp">
        <div class="dsp-stack">
            <div class="dsp-envelope"></div>
            ${dispatchSealSvg()}
            <div class="dsp-letter" id="rpg-q-drag">
                <button class="dsp-close" id="rpg-q-close" aria-label="${escapeHtml(t('close_lbl'))}">✕</button>
                ${badge}
                <div class="dsp-title-wrap"><span class="dsp-title">${escapeHtml(e.title)}<span class="dsp-hl"></span></span></div>
                <div class="dsp-body">${descHtml}</div>
                ${isNew ? '' : `<div class="dsp-hint">${escapeHtml(t('play_hint'))}</div>`}
                <div class="dsp-reward">
                    <div class="dsp-gift">${GIFT}</div>
                    <div><div class="dsp-k">${escapeHtml(t('reward'))}</div><div class="dsp-n">${rewardName}</div></div>
                </div>
                <div class="dsp-actions">${actions}</div>
                <button class="dsp-insert" id="rpg-q-insert" title="${escapeHtml(t('insert_title'))}">${ARROW}${escapeHtml(t('insert_event'))}</button>
            </div>
        </div>
    </div></div>`);

    if (isNew) {
        $('#rpg-q-accept').on('click', () => {
            gameState.activeEvent.status = 'accepted';
            saveGameState(); renderQuestPanelContent(); updateContextInjection();
            toastr.info(t('toast_event_started'));
        });
        $('#rpg-q-reject').on('click', () => {
            toastr.warning(t('toast_event_ignored'));
            clearEvent(); $('#rpg-quest-modal').removeClass('visible');
        });
    } else {
        $('#rpg-q-win').on('click', () => {
            if (gameState.activeEvent.reward) {
                gameState.inventory.push(normItem(gameState.activeEvent.reward));
                toastr.success(t('toast_reward', { name: gameState.activeEvent.reward.name }));
            }
            clearEvent(); $('#rpg-quest-modal').removeClass('visible');
        });
        $('#rpg-q-fail').on('click', () => {
            toastr.error(t('toast_failed'));
            const v = (window.RPG && window.RPG.vitals && window.RPG.vitals.available) ? window.RPG.vitals : null;
            if (v && typeof v.addBuff === 'function') {
                v.addBuff({ name: t('event_fail_debuff_name'), effect: t('event_fail_debuff_eff'), kind: 'debuff', duration: 4 });
                toastr.info(t('toast_fail_debuff'));
            } else {
                gameState.activeDebuff = `Player failed the current event and is suffering a minor setback or bad luck in the current situation.`;
            }
            clearEvent(); $('#rpg-quest-modal').removeClass('visible');
        });
    }

    $('#rpg-q-insert').off('click').on('click', insertEventToChat);
    $('#rpg-q-close').off('click').on('click', () => $('#rpg-quest-modal').removeClass('visible'));
    fitLetter();
    const dragEl = document.getElementById('rpg-q-drag') || content.find('.dsp-empty-card')[0];
    if (dragEl) makeModalDraggable(document.getElementById('rpg-quest-modal'), dragEl);
}

function fitLetter() {
    const fit = document.querySelector('#rpg-quest-content .dsp-fit');
    const card = document.querySelector('#rpg-quest-content .dsp');
    if (!fit || !card) return;
    fit.style.transform = 'none';
    const naturalH = card.offsetHeight + 30;
    const availW = Math.min(420, window.innerWidth * 0.96) - 4;
    const availH = window.innerHeight - 64;
    const s = Math.min(1, availW / 410, availH / naturalH);
    fit.style.transformOrigin = 'top center';
    fit.style.transform = 'scale(' + s + ')';
    fit.style.height = (naturalH * s) + 'px';
}


function insertEventToChat() {
    if (!gameState.activeEvent) return;
    const e = gameState.activeEvent;
    const ta = $('#send_textarea');
    ta.val(`*${e.title}*\n\n${e.desc}`).trigger('input');
    ta.focus();
    toastr.success(t('toast_event_inserted'));
}

function clearEvent() {
    gameState.activeEvent = null; saveGameState(); renderQuestPanelContent(); updateContextInjection();
}

function updateContextInjection() {
    if (!settings.enabled || settings.injectDepth < 0) return;
    let text = "";
    if (gameState.activeEvent && gameState.activeEvent.status === 'accepted') {
        text += `\n[Event currently happening: ${gameState.activeEvent.desc}]\n`;
    }
    if (gameState.activeDebuff) {
        text += `\n[Ongoing situation: ${gameState.activeDebuff}]\n`;
        gameState.activeDebuff = null; saveGameState();
    }
    const totalW = gameState.inventory.reduce((sum, i) => sum + ((typeof i.weight === 'number') ? i.weight : 1), 0);
    const cap = settings.carryCapacity || 50;
    if (totalW > cap) text += `\n[${t('inject_encumbered', { w: Math.round(totalW * 10) / 10, cap: cap })}]\n`;
    setExtensionPrompt(PROMPT_KEY, text, 2, settings.injectDepth, false, extension_prompt_roles.SYSTEM);
}

// === SETTINGS MENU ===
function settingsHtml() { return `
<div class="extension_settings rpg-engine-settings">
    <div class="inline-drawer">
        <div class="rpg-engine-toggle inline-drawer-header" style="cursor: pointer;">
            <b><i class="fa-solid fa-dice-d20"></i> ${t('set_title')}</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="display: none; padding-top: 10px;">
            <label class="checkbox_label"><input type="checkbox" id="rpg-eng-enabled"> ${t('set_enable')}</label>
            <div class="flex-container alignitemscenter flexgap5 margin-b-10" style="margin-top:8px;">
                <label>${t('set_lang')}</label>
                <select id="rpg-eng-lang" class="text_pole" style="width:auto;">
                    <option value="en">English</option>
                    <option value="ru">Русский</option>
                </select>
            </div>
            <hr class="sysHR">
            <input type="text" id="rpg-eng-base" class="text_pole margin-b-10" placeholder="${t('set_url')}" style="width:100%;">
            <input type="password" id="rpg-eng-key" class="text_pole margin-b-10" placeholder="${t('set_key')}" style="width:100%;">
            <input type="text" id="rpg-eng-model" class="text_pole margin-b-10" placeholder="${t('set_model')}" style="width:100%;">
            <hr class="sysHR">
            <div class="flex-container alignitemscenter flexgap5 margin-b-10">
                <label>${t('set_event_every')}</label>
                <input type="number" id="rpg-eng-min" class="text_pole" min="1" style="width:50px;">
                <label>${t('set_to')}</label>
                <input type="number" id="rpg-eng-max" class="text_pole" min="2" style="width:50px;">
            </div>
            <div class="flex-container alignitemscenter flexgap5 margin-b-10">
                <label>${t('set_depth')}</label>
                <input type="number" id="rpg-eng-depth" class="text_pole" min="0" style="width:50px;">
            </div>
            <div class="flex-container alignitemscenter flexgap5 margin-b-10">
                <label>${t('set_capacity')}</label>
                <input type="number" id="rpg-eng-cap" class="text_pole" min="1" style="width:60px;">
            </div>
            <label class="checkbox_label"><input type="checkbox" id="rpg-eng-gm"> ${t('set_gm')}</label>
            <label class="checkbox_label"><input type="checkbox" id="rpg-eng-announce"> ${t('set_announce')}</label>
        </div>
    </div>
</div>
`; }

function setupUI() {
    $('#extensions_settings').append(settingsHtml());
    $('.rpg-engine-settings .rpg-engine-toggle').on('click', function() {
        $(this).next('.inline-drawer-content').slideToggle();
        $(this).find('.inline-drawer-icon').toggleClass('down up');
    });

    $('#rpg-eng-enabled').prop('checked', settings.enabled).on('change', function() { 
        settings.enabled = this.checked; saveSettings(); 
        renderMainUI(); loadGameState();
    });
    $('#rpg-eng-base').val(settings.baseUrl).on('change', function() { settings.baseUrl = $(this).val(); saveSettings(); });
    $('#rpg-eng-key').val(settings.apiKey).on('change', function() { settings.apiKey = $(this).val(); saveSettings(); });
    $('#rpg-eng-model').val(settings.model).on('change', function() { settings.model = $(this).val(); saveSettings(); });
    $('#rpg-eng-min').val(settings.eventMinMessages).on('change', function() { settings.eventMinMessages = Math.max(1, parseInt($(this).val()) || 10); $(this).val(settings.eventMinMessages); saveSettings(); });
    $('#rpg-eng-max').val(settings.eventMaxMessages).on('change', function() { settings.eventMaxMessages = Math.max(2, parseInt($(this).val()) || 30); $(this).val(settings.eventMaxMessages); saveSettings(); });
    $('#rpg-eng-depth').val(settings.injectDepth).on('change', function() { settings.injectDepth = Math.max(0, parseInt($(this).val()) || 0); $(this).val(settings.injectDepth); saveSettings(); });
    $('#rpg-eng-cap').val(settings.carryCapacity).on('change', function() { settings.carryCapacity = Math.max(1, parseInt($(this).val()) || 50); saveSettings(); updateContextInjection(); });
    $('#rpg-eng-gm').prop('checked', settings.gmMode).on('change', function() { settings.gmMode = this.checked; saveSettings(); updateInventoryGrid(); });
    $('#rpg-eng-announce').prop('checked', settings.announceUse !== false).on('change', function() { settings.announceUse = this.checked; saveSettings(); });
    $('#rpg-eng-lang').val(settings.language || 'en').on('change', function() {
        settings.language = $(this).val(); saveSettings();
        $('.rpg-engine-settings').remove();
        setupUI();
        $('.rpg-engine-settings .inline-drawer-content').show();
        $('.rpg-engine-settings .inline-drawer-icon').removeClass('down').addClass('up');
        renderMainUI();
        renderQuestPanelContent();
        updateInventoryGrid();
    });
}

jQuery(() => {
    loadSettings();
    pruneOldStates();
    setupUI();
    
    // Load state on startup
    if (getContext().chatId) {
        loadGameState();
        renderMainUI();
    }

    eventSource.on(event_types.CHAT_CHANGED, (chatIdArg) => {
        // Release the previous chat's state at once: other modules react to this event too, and a
        // bridge call made before the switch completes must not save into the new chat.
        stateReady = false;
        currentChatId = null;
        pendingChatId = chatIdArg || null;
        gameState = freshGameState();
        // wait until ST switches chatId, otherwise the previous chat state is loaded
        setTimeout(() => {
            loadGameState(pendingChatId || getContext().chatId);
            renderMainUI();
        }, 100);
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => { restoreMagnifyingGlasses(); });
    eventSource.on(event_types.MESSAGE_EDITED, () => { restoreMagnifyingGlasses(); });
    eventSource.on(event_types.MESSAGE_RECEIVED, async () => { await checkEventTrigger(); });
});
// ============================================================
// CROSS-EXTENSION BRIDGE — lets Vendors (and others) read/modify the backpack.
// Safe no-op for anyone who doesn't use it.
// ============================================================
window.RPG = window.RPG || {};
// Shared name matcher, so dependent modules apply identical rules.
window.RPG.match = { key: (n) => ingKey(n), same: (a, b) => sameIng(a, b) };
window.RPG.inventory = {
    available: true,
    isEnabled: () => !!settings.enabled,
    list: () => (syncChat(), Array.isArray(gameState.inventory)) ? gameState.inventory.map(i => ({ id: i.id, name: i.name, desc: i.desc, chance: i.chance, type: i.type, weight: i.weight, heal: i.heal, food: i.food, buff: i.buff, dur: i.dur, max: i.max, broken: i.broken, cond: i.cond, grade: i.grade, armor: i.armor, attack: i.attack, patchesLeft: i.patchesLeft })) : [],
    get: (id) => { syncChat(); return (gameState.inventory || []).find(i => i.id === id) || null; },
    remove: (id) => {
        syncChat();
        const idx = (gameState.inventory || []).findIndex(i => i.id === id);
        if (idx < 0) return null;
        const removed = gameState.inventory.splice(idx, 1)[0];
        saveGameState(); updateInventoryGrid();
        return removed;
    },
    add: (item) => {
        syncChat();
        const it = { id: genId(), name: item.name, desc: item.desc || '', chance: typeof item.chance === 'number' ? item.chance : calculateChance(), type: ITEM_TYPES.includes(item.type) ? item.type : 'misc', weight: (typeof item.weight === 'number' && item.weight > 0) ? item.weight : defaultWeight(ITEM_TYPES.includes(item.type) ? item.type : 'misc') };
        if (typeof item.heal === 'number' && item.heal > 0) it.heal = item.heal;
        if (typeof item.food === 'number' && item.food > 0) it.food = item.food;
        if (item.buff && item.buff.name) it.buff = { name: String(item.buff.name), effect: String(item.buff.effect || ''), kind: item.buff.kind === 'debuff' ? 'debuff' : 'buff', duration: (typeof item.buff.duration === 'number' && item.buff.duration > 0) ? item.buff.duration : null };
        if (typeof item.dur === 'number') { it.dur = item.dur; it.max = (typeof item.max === 'number') ? item.max : item.dur; it.broken = !!item.broken; }
        // preserve equipment-only fields so gear keeps its quality/stats through a backpack round-trip
        if (typeof item.grade === 'number') it.grade = item.grade;
        if (typeof item.armor === 'number') it.armor = item.armor;
        if (typeof item.attack === 'number') it.attack = item.attack;
        if (typeof item.patchesLeft === 'number') it.patchesLeft = item.patchesLeft;
        gameState.inventory.push(it);
        saveGameState(); updateInventoryGrid();
        return it;
    },
    // raise an inventory item's durability (amount = percent of max; null = full)
    repair: (id, amount) => {
        syncChat();
        const it = (gameState.inventory || []).find(i => i.id === id);
        if (!it || typeof it.dur !== 'number') return false;
        const max = it.max || 100;
        if (amount == null) it.dur = max;
        else it.dur = Math.min(max, it.dur + Math.round(max * (amount / 100)));
        if (it.dur > 0) it.broken = false;
        saveGameState(); updateInventoryGrid();
        return true;
    },
    // patch arbitrary fields on an item (used by repair tools to track their own condition)
    update: (id, fields) => {
        syncChat();
        const it = (gameState.inventory || []).find(i => i.id === id);
        if (!it || !fields) return false;
        Object.assign(it, fields);
        saveGameState(); updateInventoryGrid();
        return true;
    },
    // wear down a repair material by `amount` condition points; delete it when it hits 0.
    // returns { left, consumed } — left = remaining condition (0 if gone), consumed = was it deleted
    consumeAsMaterial: (id, amount) => {
        syncChat();
        const it = (gameState.inventory || []).find(i => i.id === id);
        if (!it) return { left: 0, consumed: true };
        const cur = (typeof it.cond === 'number') ? it.cond : 100;
        const left = Math.max(0, cur - Math.abs(amount || 0));
        if (left <= 0) {
            const idx = gameState.inventory.findIndex(i => i.id === id);
            if (idx >= 0) gameState.inventory.splice(idx, 1);
            saveGameState(); updateInventoryGrid();
            return { left: 0, consumed: true };
        }
        it.cond = left;
        if (typeof it.chance === 'number') it.chance = Math.max(5, it.chance - 4);
        saveGameState(); updateInventoryGrid();
        return { left, consumed: false };
    },
    getCoins: () => (syncChat(), gameState.coins || 0),
    addCoins: (n) => { syncChat(); gameState.coins = Math.max(0, (gameState.coins || 0) + Math.round(n || 0)); saveGameState(); updateInventoryGrid(); return gameState.coins; },
    spendCoins: (n) => { syncChat(); n = Math.round(n || 0); if ((gameState.coins || 0) < n) return false; gameState.coins -= n; saveGameState(); updateInventoryGrid(); return true; },
    refresh: () => { loadGameState(getContext().chatId); updateInventoryGrid(); }
};

// ------------------------------------------------------------
// Foraging quests — Vendors starts an ingredient hunt; the loupe (scanMessageForLoot)
// can then turn those ingredients up while you search messages. The loupe keeps finding
// normal loot too — ingredients are only an added chance on top.
// ------------------------------------------------------------
window.RPG.quest = {
    available: true,
    isEnabled: () => !!settings.enabled,
    listForage: () => (syncChat(), (gameState.forageQuests || []).map(q => ({ id: q.id, vendorName: q.vendorName, skill: q.skill, chance: q.chance, ingredients: (q.ingredients || []).map(i => ({ name: i.name, where: i.where, roomKey: i.roomKey, got: !!i.got })) }))),
    neededNames: () => { syncChat(); return forageNeededNames(); },
    canonName: (name) => { syncChat(); return forageCanonName(name); },
    addForage: (q) => {
        syncChat();
        if (!q || !Array.isArray(q.ingredients) || !q.ingredients.length) return null;
        if (!Array.isArray(gameState.forageQuests)) gameState.forageQuests = [];
        const ings = q.ingredients
            .map(i => ({ name: String(i.name || '').slice(0, 50), where: String(i.where || '').slice(0, 80), roomKey: String(i.roomKey || '').slice(0, 50), desc: String(i.desc || '').slice(0, 120), got: false }))
            .filter(i => i.name);
        if (!ings.length) return null;
        const quest = { id: genId(), vendorName: String(q.vendorName || '').slice(0, 40), skill: String(q.skill || '').slice(0, 40), chance: Math.max(6, Math.min(80, parseInt(q.chance) || 25)), ingredients: ings };
        // merge into an existing hunt from the same vendor instead of stacking duplicates
        const prev = gameState.forageQuests.find(x => x.vendorName === quest.vendorName && x.skill === quest.skill);
        if (prev) { const have = new Set(prev.ingredients.map(i => ingKey(i.name))); ings.forEach(i => { if (!have.has(ingKey(i.name))) prev.ingredients.push(i); }); prev.chance = quest.chance; saveGameState(); return { id: prev.id, count: prev.ingredients.filter(i => !i.got).length }; }
        gameState.forageQuests.push(quest); saveGameState();
        return { id: quest.id, count: ings.length };
    },
    removeForage: (id) => { syncChat(); return removeForageQuest(id); },
    markFound: (name) => { syncChat(); return markForageFound(name); }
};
