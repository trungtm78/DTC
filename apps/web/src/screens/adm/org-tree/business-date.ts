const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** Today's date (`YYYY-MM-DD`) in the business time zone, so a default does not depend on the browser's zone. */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
