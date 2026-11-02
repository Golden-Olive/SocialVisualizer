/**
My People / My Time 영어 데모용 fetch 가로채기 — 두 페이지 진입점(pages/mypeople.js, pages/mytime.js) 맨 위에서 import된다.
아래 API 경로로 가는 요청은 백엔드 대신 demo/*.en.json(seed_fake_people.py의 하드코딩 데이터를 영어로 옮긴 것)으로 응답하므로, 백엔드/DB 없이도 같은 화면이 뜬다. 나머지 요청은 원래 fetch로 그대로 넘긴다.

Fetch interceptor for the English demo of My People / My Time — imported first by both page entry points.
Requests to the API paths below are answered from demo/*.en.json (the hardcoded data from seed_fake_people.py, translated to English) instead of the backend, so the pages render without a backend or DB. All other requests pass through to the real fetch.
 */
import peopleData from "./mypeople.en.json";
import timeData from "./mytime.en.json";

// 사이드바(appSidebar.js) 등 공용 컴포넌트가 영어 문구를 쓰도록 알려주는 플래그
window.GW_DEMO_EN = true;

const ME = peopleData.me.email;
const ROOM = timeData.room;
const people = peopleData.people;
const personByEmail = new Map(people.map((p) => [p.email, p]));
const shortBioByName = new Map(timeData.members.map((m) => [m.name, m.short_bio]));

// "YYYY-MM-DD HH:MM:SS"의 날짜 부분이 [start, end] 안에 있는지(양 끝 포함)
function inRange(dateStr, start, end) {
  const d = dateStr.slice(0, 10);
  return (!start || d >= start) && (!end || d <= end);
}

// 메일 발신/수신 표시용 "이름 <이메일>"
function addr(p) {
  return p ? `${p.name} <${p.email}>` : "";
}

// 사람별 기간 내 발신/수신 건수 — /mail-person-sent-stats, /mail-person-received-stats 공용
function personCounts(direction, key, body) {
  return people
    .map((p) => ({
      email: p.email,
      [key]: p.mails.filter((m) => m.direction === direction && inRange(m.date, body.start_date, body.end_date))
        .length,
    }))
    .filter((r) => r[key] > 0);
}

// 백엔드 get_mail_exchange_stats와 같은 규칙 — 메일이 오간 "연도"만 남기되 그 연도 안의 달은 0건이어도 전부 채운다.
function exchangeStats(body) {
  const p = personByEmail.get((body.person_user_id || "").toLowerCase());
  const byMonth = {};
  (p ? p.mails : []).forEach((m) => {
    if (!inRange(m.date, body.start_date, body.end_date)) return;
    const ym = m.date.slice(0, 7);
    byMonth[ym] = byMonth[ym] || { sent: 0, received: 0 };
    byMonth[ym][m.direction] += 1;
  });
  const startYm = (body.start_date || "0000-00").slice(0, 7);
  const endYm = (body.end_date || "9999-99").slice(0, 7);
  const years = [...new Set(Object.keys(byMonth).map((ym) => ym.slice(0, 4)))].sort();
  const monthly = [];
  years.forEach((y) => {
    for (let m = 1; m <= 12; m++) {
      const ym = `${y}-${String(m).padStart(2, "0")}`;
      if (ym < startYm || ym > endYm) continue;
      monthly.push({ month: ym, ...(byMonth[ym] || { sent: 0, received: 0 }) });
    }
  });
  const total = monthly.reduce(
    (t, m) => ({ sent: t.sent + m.sent, received: t.received + m.received }),
    { sent: 0, received: 0 }
  );
  return { monthly, total };
}

// 사람별 키워드 — 기간 안의 언급을 단어별로 합산
function personKeywords(body) {
  const p = personByEmail.get((body.person_user_id || "").toLowerCase());
  const byWord = new Map();
  (p ? p.keywords : []).forEach((k) => {
    if (!inRange(k.date, body.start_date, body.end_date)) return;
    const cur = byWord.get(k.word) || { word: k.word, count: 0, dates: [] };
    cur.count += 1;
    cur.dates.push(k.date);
    byWord.set(k.word, cur);
  });
  return [...byWord.values()].sort((a, b) => b.count - a.count);
}

// 한 달의 일별 메일 교환 건수
function dailyStats(body) {
  const p = personByEmail.get((body.person_user_id || "").toLowerCase());
  const byDate = new Map();
  (p ? p.mails : [])
    .filter((m) => m.date.startsWith(body.month))
    .forEach((m) => {
      const date = m.date.slice(0, 10);
      const cur = byDate.get(date) || { date, sent: 0, received: 0, count: 0 };
      cur[m.direction] += 1;
      cur.count += 1;
      byDate.set(date, cur);
    });
  return { days: [...byDate.values()] };
}

// 하루치 메일 목록(본문 포함)
function dayEmails(body) {
  const p = personByEmail.get((body.person_user_id || "").toLowerCase());
  const me = { name: "Me", email: ME };
  const emails = (p ? p.mails : [])
    .filter((m) => m.date.startsWith(body.date))
    .map((m) => ({
      date: m.date,
      direction: m.direction,
      subject: m.subject || "",
      sender: m.direction === "sent" ? addr(me) : addr(p),
      receiver: m.direction === "sent" ? addr(p) : addr(me),
      body: m.body || "",
    }));
  return { emails };
}

// 채팅방 일별 키워드 → 월별 합계(단어 첫 등장 순서 유지 — 동점일 때 화면 순서가 사진과 같도록)
function roomMonthlyKeywords() {
  const out = {};
  Object.entries(timeData.daily_keywords).forEach(([date, list]) => {
    const ym = date.slice(0, 7);
    const month = (out[ym] = out[ym] || []);
    list.forEach((k) => {
      const hit = month.find((x) => x.word === k.word);
      if (hit) hit.count += k.count;
      else month.push({ word: k.word, count: k.count });
    });
  });
  return out;
}

function roomDailyKeywords(month) {
  const out = {};
  Object.entries(timeData.daily_keywords).forEach(([date, list]) => {
    if (date.startsWith(month)) out[date] = list.map((k) => ({ word: k.word, count: k.count }));
  });
  return out;
}

function roomMentioners(body) {
  const hit = (timeData.daily_keywords[body.date] || []).find((k) => k.word === body.keyword);
  return hit ? hit.mentioners.map((m) => ({ participant_id: m.name, name: m.name, count: m.count })) : [];
}

// 요약의 contacts(이름 배열)를 백엔드 /chatroom-summaries와 같은 {person_name, short_bio} 형태로 펼친다.
function roomSummaries(unit) {
  const list = unit === "yearly" ? timeData.yearly : timeData.monthly;
  return list.map((s) => ({
    ...s,
    contacts: s.contacts.map((name) => ({ person_name: name, short_bio: shortBioByName.get(name) || null })),
  }));
}

const avatarMap = Object.fromEntries(people.map((p) => [p.email, p.avatar]));

// 경로 → (요청 body, URL) => 응답 JSON
const ROUTES = {
  "/accounts": (_, url) =>
    url.searchParams.get("domain") === "messenger"
      ? { accounts: [{ user_id: ROOM.chatroom_id, indexed: true }] }
      : { accounts: [{ user_id: ME, indexed: true }] },
  "/chatroom-name": () => ({ chatroom_id: ROOM.chatroom_id, data: { chatroom_name: ROOM.chatroom_name } }),
  "/messenger-chatrooms": () => ({ data: { chatrooms: [{ ...ROOM, indexed: true }] } }),
  "/self-avatar": () => ({ url: peopleData.me.avatar }),
  "/generate-self-avatar": () => ({ url: peopleData.me.avatar }),

  // My People (메일)
  "/high_affinity_person_stats": () => ({
    data: people
      .map((p) => ({ email: p.email, name: p.name, affinity: p.affinity }))
      .sort((a, b) => b.affinity - a.affinity),
  }),
  "/mail-date-range": () => ({ data: peopleData.dateRange }),
  "/contact-photos": () => ({}),
  "/person-avatars": () => avatarMap,
  "/generate-person-avatars": () => ({ data: {} }),
  "/mail-person-sent-stats": (b) => ({ data: personCounts("sent", "sent", b) }),
  "/mail-person-received-stats": (b) => ({ data: personCounts("received", "received", b) }),
  "/mail-relationships": () => ({
    data: people.map((p) => ({ person_account_id: p.email, relation_label: p.relation })),
  }),
  "/person-descriptions": () => ({
    data: people.map((p) => ({ person_account_id: p.email, description: p.description })),
  }),
  "/keyword-stats": () => ({ data: { keywords: [] } }),
  "/mail-exchange-stats": (b) => ({ data: exchangeStats(b) }),
  "/keyword-by-person-date": (b) => ({ keywords: personKeywords(b) }),
  "/mail-person-daily-stats": (b) => ({ data: dailyStats(b) }),
  "/mail-day-emails": (b) => ({ data: dayEmails(b) }),
  "/graph-data": () => ({ nodes: [], edges: [] }),

  // My Time (메일 뷰는 데모 범위 밖이라 빈 데이터)
  "/mail-summaries": (b) => ({ type: b.type, data: { summaries: [] } }),
  "/mail-keyword-monthly-stats": () => ({ data: {} }),

  // My Time (메신저 — 3학년 4반 단톡방)
  "/chatroom-summaries": (b) => ({
    chatroom_id: ROOM.chatroom_id,
    summarize_unit: b.summarize_unit,
    data: { summaries: roomSummaries(b.summarize_unit) },
  }),
  "/chatroom-keyword-monthly-stats": () => ({ data: roomMonthlyKeywords() }),
  "/chatroom-keyword-daily-stats": (b) => ({ data: roomDailyKeywords(b.month || "") }),
  "/chatroom-keyword-mentioners": (b) => ({ data: roomMentioners(b) }),
};

const realFetch = window.fetch.bind(window);

window.fetch = async (input, init = {}) => {
  const url = new window.URL(typeof input === "string" ? input : input.url, window.location.origin);
  const handler = url.origin === window.location.origin ? ROUTES[url.pathname] : null;
  if (!handler) return realFetch(input, init);

  let body = {};
  try {
    body = init.body ? JSON.parse(init.body) : {};
  } catch {
    body = {};
  }
  return new window.Response(JSON.stringify(handler(body, url)), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
