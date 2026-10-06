# ham-roster

A current list of the licensed amateur radio operators in your area, built from the FCC's
public license file and optionally merged with your own club or team list, ready to load into
RangerTrak.

**Runs entirely on your computer.** No account, no API key, no upload. The only network
request is the optional download of the FCC's public file, and it sends nothing about you or
your members. Your club list is read from disk and stays there.

Needs [Node.js](https://nodejs.org) 18 or later. Nothing to install: the one library it uses
(fflate, MIT) is in `vendor/`.

## Use

```
node ham-roster.js download --out fcc
node ham-roster.js build --fcc fcc/l_amat.zip --zips 98070,98013 --club members.csv --out results
```

1. **Download.** `l_amat.zip` is about 190 MB, every US amateur license, refreshed by the
   FCC every Sunday. The `download` command fetches it. You can also download it in a browser from
   <https://data.fcc.gov/download/pub/uls/complete/l_amat.zip>. Unzipped `.dat` files work too:
   pass the folder to `--fcc`.
2. **Area.** `--zips` takes a comma list, or a text file with one ZIP per line. `--states WA,OR`
   also works. The ZIP is the license's mailing address, so PO-box holders are included and
   people who moved without updating the FCC are where the FCC thinks they are.
3. **Club list (optional).** A CSV with a call sign column, name columns, or both. Column names
   are found loosely ("Call", "Callsign", "First Name", "Last", "Name"...). A member-number
   or REW column is carried through to the output so you can join back. A RangerTrak roster
   export (`.json`) works as well.

A build takes about 15 seconds.

## What you get

| File | |
|---|---|
| `region-hams.csv` | Everyone licensed in the area whose license is active or still renewable (`--all` keeps lapsed and cancelled too) |
| `club-merge.csv` | Every club entry, with what the FCC says about it, plus area hams who are not on the list |
| `rangertrak-roster.json` | Import on RangerTrak's Rangers page. With a club list: members who match by call sign. Without one: the whole area |
| `README.txt` | Which FCC file, which area, the counts |

`club-merge.csv` kinds, in the order to review them:

| kind | meaning | what to do |
|---|---|---|
| `call-name-differs` | The FCC holder of that call has a different surname. Calls are reissued after a license lapses | Check by hand. Probably the club list is out of date |
| `call-changed` | Same person (same FCC registration number, or the FCC lists the old call as their previous one) now holds a new call: vanity call or upgrade | Confirm, update the club list |
| `name-proposal` | No call on the club list, but exactly one licensed ham in the area has that name | Confirm it's the same person |
| `name-ambiguous` | Several possible people | Pick one or leave it |
| `matched` | Call sign and surname agree. Check `standing` | — |
| `club-only` | Not found: not a ham, licensed outside the area, or a call the FCC doesn't have | — |
| `fcc-only` | Licensed in the area, not on the club list | Recruiting list |

**standing:** `active` means licensed and unexpired. `renewable` means it expired less than two
years ago, and the FCC still allows renewal. `lapsed` and `cancelled` mean gone, from the FCC's
point of view.

## What it cannot tell you

**Whether someone is alive, or still around.** The FCC does not record deaths, and a license
runs ten years, so "active" only means "licensed". That check is for a person: a club
secretary, the team's own records, a silent-key list. Don't automate it by sending names to a
search engine or an obituary site. That sends your members' names to a third party.

## Privacy

The FCC file is public. Once you merge it with your club list, the output is your members'
personal details (names, addresses, emails), so keep the results folder on your own machine.
