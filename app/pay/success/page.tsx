// Stripe Checkout success_url lands here — on the guest's phone, seconds
// after paying. Static on purpose: the authoritative confirmation (code,
// dates, total) arrives by SMS from the hotel's line via the Stripe webhook.

export const metadata = {
  title: "Payment received — Night Desk",
};

export default function PaySuccess() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="text-5xl" aria-hidden>
          ✓
        </p>
        <h1 className="mt-4 text-2xl font-semibold">Payment received</h1>
        <p className="mt-3 opacity-75">
          Your room is confirmed. A text message with your confirmation code is
          on its way to your phone — show it at the desk when you arrive.
        </p>
        <p className="mt-6 text-sm opacity-50">
          Night Desk — after-hours reception
        </p>
      </div>
    </main>
  );
}
