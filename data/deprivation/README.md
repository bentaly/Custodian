# Deprivation reference data

Source files for `scripts/seed-deprivation.ts`, which populates the `deprivation_areas`
table (one row per UK small area → its nation's latest IMD decile).

These are **free/open** government data. Download them here (this folder is gitignored —
the files are a few MB and public, but we don't commit them). Re-download only when a
nation republishes its index (every ~5 years).

Decile data only — resolution-time geocoding is handled separately by postcodes.io.

Keep each file's natural download name — the seed (`FILES` in scripts/seed-deprivation.ts)
references these exact names. All columns verified against the live files; row counts
match the official totals (England 33,755 · Wales 1,917 · Scotland 6,976 · NI 890).

## England (latest: IoD2025)
- `File_7_IoD2025_All_Ranks_Scores_Deciles_Population_Denominators.csv` — File 7 (CSV):
  https://www.gov.uk/government/statistics/english-indices-of-deprivation-2025
- `LSOA_(2021)_to_Electoral_Ward_(2025)_to_LAD_(2025)_Best_Fit_Lookup_in_EW_v2.csv` — ward+LAD (EW):
  https://geoportal.statistics.gov.uk/datasets/ons::lsoa-2021-to-electoral-ward-2025-to-lad-2025-best-fit-lookup-in-ew-v2/about
- `LSOA_(2021)_to_Built_Up_Area_to_Local_Authority_District_to_Region_(December_2022)_Lookup_in_England_and_Wales_v2.csv` — region (EW, makes "London" work):
  https://geoportal.statistics.gov.uk/datasets/ons::lsoa-2021-to-bua-to-lad-to-region-december-2022-best-fit-lookup-in-ew-v2/about

## Wales (latest: WIMD 2025)
- `welsh-index-of-multiple-deprivation-wimd-2025-index-and-domain-ranks-and-groups-for-lower-layer-super-output-areas-lsoa-v7-en-gb.csv`
  — StatsWales "long" export (one row per area × domain × measure; the seed keeps
  Domain = "WIMD", Rank + Decile). Ward + LAD come from the shared EW lookup above:
  https://stats.gov.wales/en-GB/9706edd9-73ad-4902-bb12-7ccd7038626e

## Scotland (latest: SIMD 2020v2)
- `simd2020v2_22062020.csv` — by Data Zone. `DataZone`, `CA` (council), `SIMD2020V2Rank`,
  `SIMD2020V2CountryDecile`:
  https://www.opendata.nhs.scot/dataset/scottish-index-of-multiple-deprivation/resource/acade396-8430-4b34-895a-b3e757fa346e

## Northern Ireland (latest: NIMDM 2017) — two quirks handled
- `nimdm2017-soa.csv` — "NIMDM 2017 - SOA" (official NISRA data, mirrored). `SOA2001`,
  `LGD2014code/name`, `MDM_rank`:
  https://www.opendatani.gov.uk/dataset/northern-ireland-multiple-deprivation-measures-2017
- No decile column → the seed derives it from `MDM_rank` over 890 SOAs.
- Keyed on legacy `95…` SOA codes → resolution reads postcodes.io `lsoa11` (not `lsoa`) for NI.

## Run

    pnpm tsx scripts/seed-deprivation.ts --dry-run   # parse + report, no DB writes
    pnpm tsx scripts/seed-deprivation.ts             # seed (after db:migrate)
