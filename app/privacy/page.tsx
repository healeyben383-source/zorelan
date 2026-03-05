export default function PrivacyPolicy() {
  return (
    <main className="min-h-screen px-4 py-16">
      <div className="mx-auto w-full max-w-2xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="text-sm opacity-50">Last updated: March 2026</p>
        </div>

        <section className="space-y-3">
          <p className="text-sm leading-relaxed opacity-80">
            Zorelan is operated as a personal project. This policy explains what happens to information you enter when using Zorelan at zorelan.vercel.app.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">What we collect</h2>
          <p className="text-sm leading-relaxed opacity-80">
            Zorelan does not collect, store, or retain any personal information on our servers. We do not require you to create an account or provide your name, email address, or any identifying information to use the service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">How your inputs are processed</h2>
          <p className="text-sm leading-relaxed opacity-80">
            When you enter a question or thought into Zorelan, that text is sent to third-party AI providers to generate a response. Specifically:
          </p>
          <ul className="space-y-2 text-sm opacity-80">
            <li className="flex gap-2"><span className="opacity-40 flex-shrink-0">—</span><span><strong>OpenAI</strong> — your input is sent to OpenAI's API to generate a structured intent and a response. OpenAI's privacy policy applies to this data and can be found at openai.com/policies/privacy-policy.</span></li>
            <li className="flex gap-2"><span className="opacity-40 flex-shrink-0">—</span><span><strong>Anthropic</strong> — your input is also sent to Anthropic's API to generate a response. Anthropic's privacy policy applies and can be found at anthropic.com/privacy.</span></li>
          </ul>
          <p className="text-sm leading-relaxed opacity-80">
            We recommend you do not enter sensitive personal information, confidential business data, or anything you would not want shared with a third-party AI provider.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">History and local storage</h2>
          <p className="text-sm leading-relaxed opacity-80">
            Zorelan saves your past sessions in your browser's local storage. This data never leaves your device and is not accessible to us. You can clear your history at any time using the Clear all button in the History panel, or by clearing your browser's local storage.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Cookies and tracking</h2>
          <p className="text-sm leading-relaxed opacity-80">
            Zorelan does not use cookies or any third-party analytics or tracking tools.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Third-party links</h2>
          <p className="text-sm leading-relaxed opacity-80">
            Zorelan includes buttons to open third-party AI platforms such as ChatGPT, Claude, Gemini, and Perplexity. When you use these buttons you are leaving Zorelan and are subject to the privacy policies of those platforms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Children</h2>
          <p className="text-sm leading-relaxed opacity-80">
            Zorelan is not directed at children under the age of 13 and we do not knowingly collect any information from children.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Changes to this policy</h2>
          <p className="text-sm leading-relaxed opacity-80">
            We may update this policy from time to time. Any changes will be reflected on this page with an updated date at the top.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Contact</h2>
          <p className="text-sm leading-relaxed opacity-80">
            If you have any questions about this privacy policy you can reach us via the Zorelan website.
          </p>
        </section>

        <div className="pt-4 border-t border-black/10 dark:border-white/10">
          <a href="/" className="text-sm opacity-50 hover:opacity-100 transition-opacity">← Back to Zorelan</a>
        </div>
      </div>
    </main>
  );
}