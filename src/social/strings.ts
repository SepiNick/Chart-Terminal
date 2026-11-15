// Persian strings of the Community panel (the app translates rendered text through the FA table in ../i18n.ts).
import { FA } from '../i18n.ts';

const ADD: Record<string, string> = {
  'Community': 'انجمن', 'Feed': 'فید', 'Following': 'دنبال‌شده‌ها', 'Chat': 'گفتگو', 'Me': 'من',
  'Long': 'خرید', 'Short': 'فروش', 'Neutral': 'خنثی', 'Direction': 'جهت', 'General': 'عمومی',
  'Community needs a public server with accounts': 'انجمن به یک سرور عمومی با حساب کاربری نیاز دارد',
  'Here people share analyses, comment, follow each other and chat. Connect to a public Chart Terminal server and sign in to join.': 'اینجا افراد تحلیل‌هایشان را به اشتراک می‌گذارند، نظر می‌دهند، همدیگر را دنبال می‌کنند و گفتگو می‌کنند. به یک سرور عمومی Chart Terminal وصل شوید و وارد شوید.',
  'Share analysis': 'اشتراک تحلیل', 'Share your analysis…': 'تحلیل خود را بنویسید…', 'Title (optional)': 'عنوان (اختیاری)',
  'Symbol': 'نماد', 'Timeframe': 'تایم‌فریم', 'Attach chart snapshot': 'پیوست تصویر نمودار', 'Only this symbol': 'فقط این نماد',
  'Posts from people you follow.': 'پست‌های کسانی که دنبال می‌کنید.', 'Nobody you follow has posted yet.': 'هنوز هیچ‌کدام از دنبال‌شده‌ها پستی نگذاشته‌اند.',
  'No analyses yet. Be the first to share one.': 'هنوز تحلیلی نیست. اولین نفر باشید.',
  'Loading…': 'در حال بارگذاری…', 'Load more': 'بیشتر', 'Retry': 'تلاش دوباره', 'Open on the chart': 'باز کردن روی نمودار',
  'More': 'بیشتر', 'Like': 'پسندیدن', 'Comments': 'نظرها', 'Back': 'بازگشت', 'Chart snapshot': 'تصویر نمودار',
  'Write a comment…': 'نظر بنویسید…', 'Send': 'ارسال', 'Load older comments': 'نظرهای قدیمی‌تر', 'Delete comment': 'حذف نظر',
  'Report': 'گزارش', 'Block': 'مسدود کردن', 'Unblock': 'رفع مسدودی', 'Delete': 'حذف', 'Follow': 'دنبال کردن', 'Unfollow': 'لغو دنبال کردن',
  'Delete this post?': 'این پست حذف شود؟', 'Delete this comment?': 'این نظر حذف شود؟',
  'Why are you reporting this? (optional)': 'دلیل گزارش (اختیاری)', 'Report sent. Thank you.': 'گزارش ارسال شد. سپاس.',
  'Shared': 'منتشر شد', 'Blocked': 'مسدود شد', 'Unblocked': 'رفع مسدودی شد',
  'Chat room': 'اتاق گفتگو', 'Chat messages': 'پیام‌های گفتگو', 'Message': 'پیام',
  'Message (Enter sends, Shift+Enter for a new line)': 'پیام (Enter ارسال، Shift+Enter خط جدید)',
  'New messages ↓': 'پیام‌های جدید ↓', 'Load older messages': 'پیام‌های قدیمی‌تر', 'No messages yet. Say hello.': 'هنوز پیامی نیست. سلام کنید.',
  'Posts': 'پست‌ها', 'Followers': 'دنبال‌کننده', 'Joined': 'عضویت', 'Blocked people': 'افراد مسدودشده', 'Nobody blocked.': 'کسی مسدود نشده است.',
  'Reports': 'گزارش‌ها', 'Hide': 'پنهان', 'Dismiss': 'رد گزارش', 'No open reports.': 'گزارش بازی نیست.',
  'Enter a valid symbol': 'نماد معتبر وارد کنید', 'Enter a valid timeframe': 'تایم‌فریم معتبر وارد کنید', 'Pick Long, Short or Neutral': 'خرید، فروش یا خنثی را انتخاب کنید',
  'Write something first': 'ابتدا چیزی بنویسید', 'now': 'اکنون',
  'Community: share analyses, comment, follow and chat': 'انجمن: اشتراک تحلیل، نظر، دنبال کردن و گفتگو',
  'Community…': 'انجمن…',
};
for (const [k, v] of Object.entries(ADD)) FA[k] ??= v;   // never override a string another panel already translated
