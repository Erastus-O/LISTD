// Ported from the prototype: website/index.html.
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/listd/icon'

export function PricingView() {
  return (
    <>

  <section className="s-phead tint s-wrap"><div className="s-in"><span className="s-kicker">Pricing</span><h1 className="s-h1" style={{ maxWidth: '16ch' } as CSSProperties}>One standard. One clear price.</h1><p className="s-lead">Every booking gets the right checklist, timestamped evidence, report, support and corrections. You pay for the service, its complexity once, and urgency only when you need it. No subscription. Bristol and Birmingham share the same prices.</p></div></section>
  <section className="s-wrap" style={{ paddingBlock: 'var(--space-6) var(--space-16)' } as CSSProperties}>
    <div className="s-in">
      <div className="s-head"><h2 className="s-h2">Choose how you schedule</h2><p className="s-lead">The same service on both options. Only the timing changes.</p></div>
      <div className="s-tiers s-tiers-2">
        <div className="s-tier pop"><span className="flag ld-badge ld-badge-solid">Base price</span><h3>Standard</h3><p className="rec">Any date more than two working days ahead.</p><div className="price"><b className="num">£0</b><small>no adjustment</small></div><Link href="/auth?tab=signup" className="ld-btn ld-btn-primary ld-btn-full">Get started</Link>
          <ul><li><Icon name="calendar" size={18} /> Pick your own date and window</li><li><Icon name="file" size={18} /> Report deadline shown for every service</li><li><Icon name="signature" size={18} /> Pay only when you approve the quote</li></ul></div>
        <div className="s-tier"><h3>Priority</h3><p className="rec">Within two working days, when a Pro is available. Applied automatically when you pick a sooner date. Priority changes when the job happens, never how well it’s done.</p><div className="price"><b className="num">+£30</b><small>per visit</small></div><Link href="/auth?tab=signup" className="ld-btn ld-btn-secondary ld-btn-full">Get started</Link>
          <ul><li><Icon name="clock" size={18} /> Faster appointment; report deadlines stay the same</li><li><Icon name="success" size={18} /> Same checklist, evidence and report: every item rated, damage shown close up with scale references</li><li><Icon name="info" size={18} /> Shown only when we have the capacity</li></ul></div>
      </div>
    </div>
  </section>
  <section className="s-sec s-wrap" style={{ background: 'var(--surface)', paddingTop: 'var(--space-16)' } as CSSProperties}>
    <div className="s-in">
      <div className="s-head"><span className="s-kicker">Inspections</span><h2 className="s-h2">Inspection prices</h2><p className="s-lead">Standard scheduling, unfurnished, for ordinary properties. Bristol and the South West today; Birmingham uses the same prices when inspections launch there. The size price already includes the bedrooms.</p></div>
      <div className="ld-tablewrap"><table className="ld-table s-cmp s-rate">
        <caption className="ld-sr">Inspection prices by property size</caption>
        <thead><tr><th scope="col">Property size</th><th scope="col">Inventory &amp; Condition</th><th scope="col">Standalone check-in</th><th scope="col">Inventory + check-in, same visit</th><th scope="col">Mid-term</th><th scope="col">Check-out</th></tr></thead>
        <tbody><tr><td className="tc">Studio</td><td className="num">£85</td><td className="num">£60</td><td className="num">£110</td><td className="num">£60</td><td className="num">£75</td></tr><tr><td className="tc">1 bedroom</td><td className="num">£100</td><td className="num">£60</td><td className="num">£125</td><td className="num">£65</td><td className="num">£90</td></tr><tr><td className="tc">2 bedrooms</td><td className="num">£120</td><td className="num">£65</td><td className="num">£145</td><td className="num">£75</td><td className="num">£110</td></tr><tr><td className="tc">3 bedrooms</td><td className="num">£140</td><td className="num">£70</td><td className="num">£165</td><td className="num">£85</td><td className="num">£130</td></tr><tr><td className="tc">4 bedrooms</td><td className="num">£160</td><td className="num">£75</td><td className="num">£185</td><td className="num">£95</td><td className="num">£150</td></tr><tr><td className="tc">5+ bedrooms</td><td colSpan={5}>Custom quote</td></tr></tbody>
      </table></div>
      <div className="s-facts" style={{ marginTop: 'var(--space-6)' } as CSSProperties}>
        <div className="s-fact"><span className="k"><b>Inventory &amp; Condition</b></span><span className="k">Creates the property’s baseline record: every room, item and meter, with photos.</span></div>
        <div className="s-fact"><span className="k"><b>Check-in handover</b></span><span className="k">Confirms an existing, suitable inventory, then records keys, meters and handover observations with the tenant.</span></div>
        <div className="s-fact"><span className="k"><b>Inventory + check-in</b></span><span className="k">Both in one coordinated visit, for less than booking them separately.</span></div>
      </div>
      <p className="s-fine" style={{ textAlign: 'center', marginTop: 'var(--space-6)' } as CSSProperties}>Pilot prices. Your total, including any VAT, is confirmed in your quote before you pay.</p>
    </div>
  </section>
  <section className="s-sec s-wrap">
    <div className="s-in s-split" style={{ alignItems: 'start' } as CSSProperties}>
      <div style={{ display: 'grid', gap: 'var(--space-5)' } as CSSProperties}>
        <span className="s-kicker">One complexity adjustment</span><h2 className="s-h2">Furnishing is charged once</h2>
        <p className="s-lead">No separate furnished price lists and no per-bedroom fee on top. One furnishing charge, one visible total.</p>
        <div className="ld-tablewrap"><table className="ld-table s-cmp"><caption className="ld-sr">Furnishing adjustments</caption><thead><tr><th scope="col">Furnishing</th><th scope="col">Adjustment</th></tr></thead><tbody>
          <tr><td className="tc">Unfurnished</td><td className="num">£0</td></tr><tr><td className="tc">Part-furnished</td><td className="num">+£10</td></tr><tr><td className="tc">Normally furnished, studio to 2 bedrooms</td><td className="num">+£20</td></tr><tr><td className="tc">Normally furnished, 3 to 4 bedrooms</td><td className="num">+£30</td></tr><tr><td className="tc">Heavily furnished or very detailed</td><td>Custom quote</td></tr>
        </tbody></table></div>
        <p className="s-fine">Included: your bedrooms, one kitchen, one bathroom, one living room and ordinary hallways. Extra bathrooms, kitchens or reception rooms are £10 each; outbuildings and large outdoor areas are £15 each. Each extra room is its own visible line in your quote. Unusually large properties are reviewed before we price them.</p>
      </div>
      <div className="s-tier" style={{ alignSelf: 'start' } as CSSProperties}><span className="ld-eyebrow">Worked example</span><h3>Two-bedroom furnished flat</h3>
        <dl className="s-calc"><dt>Inventory + check-in, same visit</dt><dd className="num">£145</dd><dt>Furnishing</dt><dd className="num">+£20</dd><dt><b>Standard total</b></dt><dd className="num"><b>£165</b></dd><dt>Priority appointment</dt><dd className="num">+£30</dd><dt><b>Priority total</b></dt><dd className="num"><b>£195</b></dd></dl>
        <p className="s-fine">One furnishing charge. No additional bedroom charge. One visible total.</p></div>
    </div>
  </section>
  <section className="s-sec s-wrap" style={{ background: 'var(--surface)' } as CSSProperties}>
    <div className="s-in">
      <div className="s-head"><span className="s-kicker">Maintenance</span><h2 className="s-h2">Cleaning and repairs have their own pricing</h2><p className="s-lead">They never borrow inspection prices. You always see a fixed price before you pay.</p></div>
      <div className="s-tiers">
        <div className="s-tier"><h3>Cleaning</h3><p className="rec">See an estimate while you book, then approve a fixed quote for a stated checklist before you pay.</p>
          <ul><li><Icon name="cleaning" size={18} /> <span><b>Standard Home Cleaning</b>: worktops, hob, sink, bathrooms, floors, dusting and bins. Minimum booking applies.</span></li><li><Icon name="cleaning" size={18} /> <span><b>Deep Cleaning</b>: adds oven, fridge and freezer, inside cupboards, interior windows and behind furniture.</span></li><li><Icon name="cleaning" size={18} /> <span><b>End of Tenancy Cleaning</b>: to a check-out standard, after a condition and appliance assessment.</span></li><li><Icon name="cleaning" size={18} /> <span><b>Office Cleaning</b>: quoted on floor area, facilities, access and frequency.</span></li><li><Icon name="plus" size={18} /> <span>Add-ons where not included: oven, fridge, inside cupboards, carpets, exterior windows.</span></li></ul></div>
        <div className="s-tier"><h3>Repairs &amp; Maintenance</h3><p className="rec">A fixed task price when the job is clear. A paid diagnosis when it isn’t.</p>
          <ul><li><Icon name="file" size={18} /> <span><b>Fixed task price</b>: an itemised quote for labour and materials, approved before the repair is booked.</span></li><li><Icon name="search" size={18} /> <span><b>£50 diagnostic visit</b>: finds the cause and prices the repair. The fee is credited against the repair if you go ahead.</span></li><li><Icon name="signature" size={18} /> <span>Any additional work needs your approval before it starts.</span></li></ul></div>
        <div className="s-tier"><h3>Portfolio pricing</h3><p className="rec">Pay per completed service, with no subscription. Regular, well-planned work earns better rates.</p>
          <ul><li><Icon name="check" size={18} /> <span><b>1–9 jobs a month</b>: standard prices.</span></li><li><Icon name="star" size={18} /> <span><b>10–24 jobs a month</b>: up to a 5% rebate on service fees.</span></li><li><Icon name="users" size={18} /> <span><b>25+ jobs a month</b>: a negotiated rate based on location, scope and scheduling.</span></li><li><Icon name="info" size={18} /> <span>Rebates exclude materials, exceptional travel and Priority premiums.</span></li></ul></div>
      </div>
    </div>
  </section>
    </>
  )
}
