// 한국(KST)과 일본(JST)은 모두 UTC+9 이므로 시차 보정이 필요 없다.
// 따라서 도착시각(현지) = 출발시각(인천) + 운항시간(block time).

export function toMinutes(hhmm) {
  if (hhmm == null) return null;
  const s = String(hhmm).trim();
  const m = s.match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return h * 60 + min;
}

export function toHHMM(minutes) {
  if (minutes == null) return null;
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function addMinutes(hhmm, delta) {
  const base = toMinutes(hhmm);
  if (base == null) return null;
  return toHHMM(base + delta);
}

export function durationLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

// days: '1234567' 형태 또는 [true,...] 7칸 배열
export function daysLabel(days) {
  if (!days) return '매일';
  const set = Array.isArray(days)
    ? days.map(Boolean)
    : DAY_LABELS.map((_, i) => String(days).includes(String(i + 1)));
  if (set.every(Boolean)) return '매일';
  const picked = DAY_LABELS.filter((_, i) => set[i]);
  return picked.length ? picked.join('·') : '운항일 미상';
}

export function includesMonday(days) {
  if (!days) return true;
  return Array.isArray(days) ? Boolean(days[0]) : String(days).includes('1');
}
