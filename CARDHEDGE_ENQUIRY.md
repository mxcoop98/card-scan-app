# CardHedge API enquiry — draft

Status: **not sent.** Two blanks marked `[…]` need Dan's numbers before sending.

Contact route: https://ai.cardhedger.com/api-services → "Get API Access" / "Apply Now"
(sales-led; no public pricing, which is the whole reason for asking).

Why them over the alternatives, for context when their reply comes back:
they're the only candidate that could cover sports pricing, sports
identification, Pokémon identification and PSA population data in one
integration — and unlike SportsCardsPro their terms are aimed at people
shipping public products. See `HANDOFF.md` → "Sports pricing — the decision"
for the full comparison.

---

**Subject:** API pricing enquiry — card identification + pricing for a collection-tracking app

Hi,

I'm building a card collection tracker — users photograph a card, the app
identifies it, and tracks its value over time alongside cost basis and P&L.
Pokémon is working today against a free catalog; I'm looking for a data
partner to cover sports cards, and ideally to replace my home-grown
identification too.

**What I'd want from your API**

1. **Card identification from a photo** — your AI vision endpoint. Today I OCR
   the card and infer the name/number, which works acceptably for Pokémon but
   is weak on sports. Being able to send an image and get a specific printing
   back is the piece I can't build well myself.
2. **Current market price** for an identified card, raw and by grade (PSA 9/10
   at minimum). Graded values also feed a "is this worth grading" calculator.
3. **Price history**, if it's available at a sane price — the app charts
   portfolio value over time, and history would let me backfill rather than
   only accumulate forward.
4. **Population report data**, if you have it.

Sports is the priority; if your Pokémon coverage is comparable I'd likely move
that over too rather than run two providers.

**Volume**

Small and predictable, and I'd rather tell you honestly than have you price for
a scale I don't have:

- The app snapshots every card in a collection once daily, so **price lookups ≈
  collection size × 1/day**. At `[…]` cards that's roughly `[…]` calls/month.
- **Identification calls are far rarer** — one per card added, not per day. Realistically
  tens per month per active user, spiking when someone catalogs a backlog.
- It's currently pre-launch, so today's real volume is negligible. I'm asking so I
  can design against your pricing rather than discover it later.

If you price per request, the daily-snapshot pattern is the number that matters;
if there's a cheaper way to refresh many cards at once (batch endpoint, or a bulk
price file I pull daily), that would likely suit both of us better than N
individual calls.

**The questions that decide this for me**

1. **What does it cost?** A rough band is fine at this stage — I mainly need to
   know whether this is a $50/month product or a $2,000/month one.
2. **Is identification priced separately from price lookups**, and if so how?
3. **Licensing:** the app is publicly accessible (web now, App Store later), so
   end users see prices derived from your data. Is that within your standard
   terms? I ask specifically because at least one other provider in this space
   restricts API data to internal business use, which rules them out for me. If
   you need attribution or a link back, that's fine — tell me the form you want.
4. **Rate limits**, and what happens on overage — hard block or metered?
5. **Is there a trial or sandbox key** so I can evaluate identification accuracy
   on real cards before committing?
6. **Coverage:** which sports/eras, and how far back does pricing go?

Happy to share more about the app if useful.

Thanks,
Dan

---

## Notes for whoever picks this up

- Don't send until the two `[…]` volume blanks are filled — a vague volume
  invites an enterprise quote.
- Question 3 is the one that actually gates the decision. SportsCardsPro is
  otherwise a fine, cheaper product ($49/mo) and is ruled out purely on that
  clause. If CardHedge answers the same way, the shortlist is empty and the
  fallback is manual value entry.
- Question 5 matters more than it looks: sports OCR accuracy here is measurably
  weak, and identification quality is the thing most likely to disappoint. Get a
  key and test it on real cards before paying.
