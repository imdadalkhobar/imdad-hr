/**
 * التسجيل التلقائي اليومي للحضور — Saudi HR Pro
 * يعمل عبر GitHub Actions بجدولة يومية، مستقل عن فتح النظام في المتصفح.
 * يتخطّى الجمعة، ويحترم الإجازات المعتمدة، ولا يكرّر التسجيل.
 * الدوام الموحّد: 08:00 إلى 16:00 (8 ساعات).
 * الأسرار تُقرأ من متغيّرات البيئة (GitHub Secrets).
 */

const DB_URL = process.env.FIREBASE_DB_URL;
const SECRET = process.env.FIREBASE_SECRET;
const ROOT = 'hr-data';

if (!DB_URL || !SECRET) {
  console.error('مفقود: FIREBASE_DB_URL أو FIREBASE_SECRET.');
  process.exit(1);
}

function todayRiyadh() {
  const r = new Date(Date.now() + 3 * 3600 * 1000);
  return r.toISOString().slice(0, 10);
}
function dayOfWeekRiyadh() {
  const r = new Date(Date.now() + 3 * 3600 * 1000);
  return r.getUTCDay();
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function dbGet(path) {
  const url = DB_URL + "/" + path + ".json?auth=" + SECRET;
  const res = await fetch(url);
  if (!res.ok) throw new Error('GET ' + path + ' -> ' + res.status);
  return res.json();
}
async function dbPut(path, data) {
  const url = DB_URL + "/" + path + ".json?auth=" + SECRET;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('PUT ' + path + ' -> ' + res.status);
  return res.json();
}

function isApprovedLeave(leaves, empId, dateStr) {
  return (leaves || []).some(
    (l) => l && l.empId === empId && l.status === 'approved' &&
           l.from <= dateStr && l.to >= dateStr
  );
}

async function main() {
  const date = todayRiyadh();
  const dow = dayOfWeekRiyadh();
  if (dow === 5) {
    console.log('اليوم ' + date + ' جمعة — لا تسجيل (عطلة).');
    return;
  }
  const [employees, attendanceRaw, leavesRaw] = await Promise.all([
    dbGet(ROOT + '/employees'),
    dbGet(ROOT + '/attendance'),
    dbGet(ROOT + '/leaves'),
  ]);
  const empList = Array.isArray(employees) ? employees : Object.values(employees || {});
  const attList = Array.isArray(attendanceRaw) ? attendanceRaw : Object.values(attendanceRaw || {});
  const leaves = Array.isArray(leavesRaw) ? leavesRaw : Object.values(leavesRaw || {});
  const active = empList.filter((e) => e && e.status !== 'inactive');
  let created = 0;
  for (const e of active) {
    const already = attList.some((a) => a && a.empId === e.id && a.date === date);
    if (already) continue;
    const onLeave = isApprovedLeave(leaves, e.id, date);
    attList.push({
      id: uid(),
      empId: e.id,
      empName: e.nameAr || e.nameEn || '',
      date: date,
      status: onLeave ? 'leave' : 'present',
      timeIn: onLeave ? '' : (e.wStart || '08:00'),
      timeOut: onLeave ? '' : (e.wEnd || '16:00'),
      overtime: 0,
      note: 'تسجيل تلقائي (GitHub Actions)',
      auto: true,
    });
    created++;
  }
  if (created > 0) {
    await dbPut(ROOT + '/attendance', attList);
    console.log('تم تسجيل ' + created + ' موظف ليوم ' + date + '.');
  } else {
    console.log('لا جديد ليوم ' + date + '.');
  }
}

main().catch((err) => {
  console.error('فشل التسجيل التلقائي:', err.message);
  process.exit(1);
});
