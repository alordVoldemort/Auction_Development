const { formatInTimeZone, toZonedTime } = require('date-fns-tz');
const TZ = 'Asia/Kolkata';

/* --------------  WRITE helpers  ---------------- */
// "2025-09-08"  ->  Date-object that **IST** midnight
const toISTDate = (yyyyMMdd, hhmmss = '00:00:00') =>
  toZonedTime(`${yyyyMMdd} ${hhmmss}`, TZ);

// Date-object  ->  "2025-09-08"
const istDateString = (dt) =>
  formatInTimeZone(dt, TZ, 'yyyy-MM-dd');

/* --------------  READ helpers  ---------------- */
// make sure row.auction_date is always the **IST** calendar day
const normaliseRow = (row) => {
  if (!row) return row;
  // if for some reason it comes back as Date -> convert to IST string
  if (row.auction_date instanceof Date) {
    row.auction_date = istDateString(row.auction_date);
  }
  return row;
};

module.exports = { toISTDate, istDateString, normaliseRow };