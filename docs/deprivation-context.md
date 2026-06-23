# Deprivation Context — what it is and how it works

*A plain-English summary for sharing. Built and working on staging.*

## The problem we solved

When trustees review a grant application, one of the most useful things to know is:
**how deprived is the area this project will actually help?** A £50k youth project in
one of the most deprived neighbourhoods in the country is a very different proposition
from the same project in a wealthy suburb.

There are official UK "deprivation" rankings that answer exactly this, but the ready-made
services that look them up charge per request and were surprisingly expensive. We didn't
want an ongoing bill for something the underlying data is free and public.

## What we built

Every application now automatically gets a **Deprivation context** panel. The foundation
gives us a location for where the project is delivered (a postcode, a town, a city — whatever
the applicant wrote), and we turn it into an official deprivation reading, shown as a
**decile**:

> **Decile 1 = among the most deprived 10% of areas in the country.
> Decile 10 = among the least deprived 10%.**

For a precise postcode we show a single decile. For a broader place (a town or city) we
show the **range** across that area — e.g. *"Decile 1–9, typically around 3"* — because a
whole city naturally spans rich and poor neighbourhoods. It's colour-coded so the picture
is instant.

## How it works, simply

1. We read the **project's delivery area** from the application.
2. We work out *where that is* on the map (using free address/map services).
3. We look up the **official government deprivation ranking** for that area, from data we
   hold ourselves.
4. We show the decile (or range) on the application, labelled with which official index
   and year it came from.

All of this happens automatically when an application arrives — alongside the existing
AI score and due-diligence checks.

## The decisions worth knowing about

- **It's free to run.** We use the official, open government deprivation datasets (which we
  host ourselves) plus free map look-up services. No per-use fees, no ongoing licence.

- **It covers the whole UK.** England, Scotland, Wales and Northern Ireland each publish
  their *own* deprivation index, measured differently. We use all four and always label
  which one a reading came from — we never pretend a Glasgow score and a Bradford score
  are on the same scale, because officially they aren't.

- **It measures where the project is *delivered*, not where the charity is based.** An
  organisation might be registered in a smart part of London but deliver its work in a
  deprived area elsewhere — what matters for funding is the community served. The system is
  specifically set up to pick the delivery area and ignore the organisation's own address.

- **It's honest when it can't be sure.** "London" is too big and varied to reduce to one
  number, so we show the spread across the whole city. Something genuinely too broad or
  vague ("the North of England") or a typo'd location is shown plainly as *"couldn't
  determine"* rather than inventing a misleading figure. Staff can correct the location by
  hand if needed.

## What it looks like

On each application, a **Deprivation context** card shows:

- the headline decile or range (e.g. **"Decile 2–6"**, with a "typically 3"),
- a small colour bar showing how the area's neighbourhoods are spread from most to least
  deprived,
- which area it matched (e.g. *"Leeds · local authority · 488 neighbourhoods"*),
- and which official index + year it's based on.

There's a **Re-run** button to refresh it if the location is corrected.

## Honest limitations

- **Different nations, different scales.** Deciles are only strictly comparable *within* a
  nation. We label every reading so no one over-reads a cross-border comparison.
- **Some nations' data is older.** England and Wales refreshed their indices in 2025;
  Scotland's latest is 2020 and Northern Ireland's is 2017 — simply because those
  governments haven't published anything newer. We use the latest each nation has, and
  show the year.
- **Broad or messy inputs won't resolve.** That's by design — better an honest blank than a
  wrong number.
- **Refreshed every few years.** The underlying data only changes when a government
  republishes (roughly every 5 years), so it's effectively "set and forget" until then.

## Status & cost

- **Status:** built, tested, and working on the staging environment, across all four UK
  nations and across postcodes, towns, cities and regions.
- **Ongoing cost:** effectively £0 — free public data plus free look-up services.
