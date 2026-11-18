// One item per overdue loan, each with its reminder email ready to send.
// Returning no items ends the run cleanly when nothing is overdue.
const { loans = [] } = $input.first().json;
const appUrl = ($env.LENDLOOP_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const fmt = (iso) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

return loans.map((loan) => ({
  json: {
    reminderKey: loan.reminderKey,
    to: loan.borrower.email,
    subject: `Reminder: the ${loan.toolName} was due back ${fmt(loan.endDate)}`,
    text:
      `Hi ${loan.borrower.firstName},\n\n` +
      `Just a friendly nudge: the ${loan.toolName} you borrowed was due back on ${fmt(loan.endDate)} ` +
      `(${loan.daysOverdue} ${loan.daysOverdue === 1 ? 'day' : 'days'} ago). ` +
      `Please return it to the lender as soon as you can.\n\n${appUrl}${loan.appPath}\n\n` +
      `LendLoop · Borrow what you need. Lend what you don't.`,
  },
}));
