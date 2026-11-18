// Turn the (minimal) event into one email. The payload only contains the
// recipient's first name and email, the tool name, dates and a link path.
const { event } = $input.first().json;
const appUrl = ($env.LENDLOOP_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const link = appUrl + event.appPath;
const name = event.recipient.firstName;
const tool = event.tool.name;

const fmt = (iso) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
const dates = event.loan.startDate === event.loan.endDate
  ? fmt(event.loan.startDate)
  : `${fmt(event.loan.startDate)} to ${fmt(event.loan.endDate)}`;

const templates = {
  'loan.requested': {
    subject: `New request to borrow your ${tool}`,
    body: `A neighbour would like to borrow your ${tool} (${dates}).\n\nApprove or decline it here:\n${link}`,
  },
  'loan.approved': {
    subject: `Approved: you can borrow the ${tool}`,
    body: `Good news! Your request to borrow the ${tool} (${dates}) was approved.\n\nDetails:\n${link}`,
  },
  'loan.declined': {
    subject: `Update on your request for the ${tool}`,
    body: `Sorry, your request to borrow the ${tool} (${dates}) was declined this time.\n\nFind something similar:\n${appUrl}/browse`,
  },
  'loan.cancelled': event.recipient.role === 'lender'
    ? {
        subject: `A request for your ${tool} was cancelled`,
        body: `The borrower cancelled their request for your ${tool} (${dates}). No action needed.\n\n${link}`,
      }
    : {
        subject: `Your request for the ${tool} was cancelled`,
        body: `The listing for the ${tool} was removed, so your request (${dates}) was cancelled.\n\nFind something similar:\n${appUrl}/browse`,
      },
  'loan.returned': {
    subject: `Thanks for returning the ${tool}`,
    body: `The lender marked the ${tool} as returned. Thanks for borrowing responsibly!\n\n${link}`,
  },
};

const t = templates[event.type];
if (!t) throw new Error(`Unknown event type: ${event.type}`);

return [{
  json: {
    eventId: event.id,
    to: event.recipient.email,
    subject: t.subject,
    text: `Hi ${name},\n\n${t.body}\n\nLendLoop · Borrow what you need. Lend what you don't.`,
  },
}];
