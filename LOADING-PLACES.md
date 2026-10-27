# Loading places onto the RangerTrak map

Places are the fixed points on your map: shelters, staging areas, fire stations, water points,
the command post. Most groups already keep them in Excel, Google Sheets or a Google My Maps map.

"Places" and "locations" mean the same thing for these map points. This guide says Places.

**Your places never leave your device.** RangerTrak reads the file in your browser. Nothing is
uploaded, and there is no account to make.

On the **Map** page, open **Import, export & print** (near the bottom) and choose **Import
places…**. You always see a preview first: how many places would be added, updated or left as
they are, which rows were skipped and why, and which categories are new. Nothing changes until you
press **Add to map**, and **nothing is deleted unless you say so** (see *A newer version of the same
list*, below). A blank cell never erases what a place already has.

## From a spreadsheet

Download the template from the same panel (**Download template (Excel)** or **(CSV)**), or keep
your own sheet as it is: RangerTrak asks which column is which and remembers your answer.

| Column | Needed? | What goes in it |
|---|---|---|
| **Name** | Yes | What the place is called. A place with the same name as one already on the map is updated, not duplicated |
| **Category** | Recommended | Shelters, Staging Areas, Fire Stations. New ones are added to the mission's list; blank goes to "Other" |
| **Latitude**, **Longitude** | Yes (or a WKT column) | Decimal degrees, such as 47.41000 and -122.46000. South and west are negative |
| **Address** | Optional | Kept as text only. RangerTrak does not look addresses up |
| **Notes** | Optional | Hours, "generator on site", who holds the key |

**Rows without coordinates are skipped**, and the preview names each one by its row number. Fix
them in your sheet and import again.

## From Google My Maps

In My Maps, open the menu beside the map's title and choose **Export to KML/KMZ**. Import that
file here. **Each My Maps layer becomes a category**, so a layer called "Shelters" gives you a
Shelters category. Lines and shapes are skipped; only single points come across. (My Maps can also
export a CSV; its `WKT` column holds `POINT (longitude latitude)` and is read too.)

## From GeoJSON

A `.geojson` file is read the same way: single points only, with the place name from `name` or
`title` and the category from `category`, `type` or `layer`.

## A newer version of the same list

Places match on their hidden RangerTrak id first, then on exact name, so a place that was **renamed**
in a newer file (a file RangerTrak exported carries the ids) is updated, not added a second time.

In the preview, the **Layer name** box is how the device remembers a list. A spreadsheet suggests a
name from its file name (`Shelters 2026-10-15.xlsx` suggests *Shelters*); a Setup file brings its own.
Import the next version under the same name and, if places that were in the last version aren't in this
one, RangerTrak asks:

> 2 places are no longer in Shelters. Remove them?

It starts at **No, keep them**. **Yes** removes just those places, never one another list also has, and
never one you added by hand. Leave the name blank and nothing is remembered. **Layers on this device**,
in the same panel on the Map page, lists what the device remembers and has **Remove this layer**.

## Handing places on

**Export places** lets you tick the categories you want first (and, on the Leaflet map, narrow it
to the places in the current view), then save them as a spreadsheet, a CSV or a **Setup file**
with a name you choose, such as "Fernhollow shelters, Oct 2026". The spreadsheet and CSV load
straight back in with no column choices to make. A file of places holds no personal information.

**Print places** (the same panel) prints the same chosen places as a list on paper, grouped by category in
the mission's own order: name, address, coordinates and note. On the Leaflet map a small map of those
places runs across the top of the page; with the MapLibre map the list prints without it. The
coordinates are written in the format picked on the card (DD, DDM or USNG). **Print map** is a different
print and is unchanged.
