# Loading your roster into RangerTrak

Your roster is the list of people RangerTrak knows by name: who they are, what to call them on
the radio, and how to reach them. Most groups already have one in Excel, Google Sheets or a
county system. This page explains how to get it into RangerTrak.

**Your roster never leaves your device.** RangerTrak reads the file in your browser. Nothing is
uploaded, and there is no account to make.

## 1. Start from the template, or from what you already have

There are two ways to start:

- **You have no list yet:** on **Rangers**, open **Import, export & print** and choose **Download
  template (Excel)** (or **(CSV)**). Type your people into the **Roster** sheet. The **Example**
  sheet shows made-up people.
- **You already have a spreadsheet:** keep it as it is. You don't need to rename its columns to
  match the template. Step 4 lets you say which column is which.

## 2. What RangerTrak needs for each person

| Column | Needed? | What goes in it |
|---|---|---|
| **Ranger ID** | This **or** Call Sign | The ID your people already know: REW#, DSW#, a member number. Leave it blank if one hasn't been issued yet |
| **Call Sign** | This **or** Ranger ID | Their FCC amateur call, such as WZ0HAZ. Leave it blank for people who aren't licensed; that's fine |
| **Full Name** | Recommended | As you'd say it on the radio or read it on a badge |
| **Phone** | Optional | The number to reach them during an incident |
| **Team** | Optional | Their team. One unique name per team; with mutual aid, include the town or department, e.g. "Burien CERT 2" |
| **Role** | Optional | What they usually do: Net control, First aid, Shelter lead |
| **Notes** | Optional | Anything a scribe should see: qualifications, "no phone on file" |

- **One row per person.** Each Ranger ID should belong to one person.
- **Extra columns are fine.** RangerTrak ignores the ones it doesn't use.
- **First and last name in separate columns is fine.** RangerTrak joins them.
- **A Status column is fine.** If it has one, RangerTrak offers to skip the rows marked Exited, Inactive, Retired, Resigned, Terminated, Former, Removed or Left.
- **RangerTrak doesn't store addresses or e-mail addresses.** You can leave them in your
  spreadsheet; they won't be imported, and the preview tells you which columns it left out.
- **If your group calls the ID something else** ("REW#", "Member #"), you can rename the label
  on the **Mission** page.

## 3. Your list is in Google Sheets or OneDrive?

RangerTrak reads files, not links, so download your list first:

- **Google Sheets:** *File → Download → Microsoft Excel (.xlsx)* or *Comma-separated values (.csv)*.
- **OneDrive / Excel online:** *File → Create a copy → Download a copy*, or *File → Save as →
  Download a copy*.
- **Excel on your computer:** use the `.xlsx` file as it is, or choose *File → Save As → CSV UTF-8*.
- **A county or agency system:** use its "Export" or "Download" button and save as Excel or CSV.

Then import the downloaded file. On a phone or computer, the file picker shows your OneDrive and
Google Drive folders, so you can choose the file straight from there once it has been downloaded or
made available offline. A Google Sheets document itself has to be downloaded first.

> **Never use Google Sheets' "Publish to the web" to get your roster into RangerTrak.** It makes
> the whole roster public, at an address anyone can find. Downloading a file is safe; publishing
> it isn't.

## 4. Import it

1. Open **Rangers**, then **Import, export & print**, then **Import a list…**, and pick your file.
2. RangerTrak shows your columns, three example values from each, and a guess at which one is
   which: *Name*, *Cell*, *REW#* and so on. Fix any guess that's wrong, and set columns you don't
   want to *Ignore*. (A spreadsheet with several sheets lets you pick the sheet.)
3. Choose **Continue**. RangerTrak shows a preview: how many people it would **add**, **update**,
   leave **unchanged** and **skip**, who would be updated and which of their details would
   change, and any problems (a row with no ID, no call sign and no name, or an ID that matches
   one person while the call sign matches another).
4. Choose **Add to roster** (the usual choice) to add new people and update the ones already
   there, or **Replace roster…** to start over (it asks you to confirm). RangerTrak then tells
   you who it added and updated.

The next time you import a spreadsheet with the same column headings, RangerTrak remembers your
column choices, so a repeat import is one click on **Continue**. Only the headings are
remembered, never anyone's details.

A file you saved from RangerTrak's own **Export roster** goes back in the same way, with nothing
to fix, and the preview shows everyone as unchanged. A Setup file (made on the Mission page, under Data safety)
and an older RangerTrak file also open with **Import a list…**; they show the same preview.

## Building up your roster from several lists

You don't need one master list before you start. Most groups' people are spread across
several lists: the CERT roster, the ham club, a neighbourhood team, the EOC staff. **Import them
one after another, and each one adds to what's already there.**

For example, on a new device:

1. Import the CERT list: *Added 33 rangers.*
2. Import the ACS / radio club list: *Added 12 rangers, updated 4.* The 4 are people on both
   lists.
3. Import Team D's list: *Added 6 rangers, updated 2.*

After each import RangerTrak tells you what it did, by name: who it **added**, who it **updated**
(and which details changed), and how many were already up to date. The Setup file card on the Mission page
shows the same kind of summary before it saves anything, and says how many photos it stored.

**What "updated" means.** When someone in the file is already on the device, RangerTrak treats
them as the same person and fills their details in from the file. The newest file wins. A blank
cell never erases anything: if the radio club list has no phone number for someone, the one from
the CERT list stays. If the CERT list has an old phone number and the radio club list has the new
one, import the CERT list first.

**How it recognises the same person:** by Ranger ID first, then by call sign. Someone who has an
ID in one list and only a call sign in another may turn up twice. Delete the extra row on the
Rangers page, or give them their ID in both lists.

**Importing never deletes anyone on its own.** People who aren't in a file stay on the device as
they were. The one exception is a question you answer, covered next.

**A newer version of the same list.** In the preview, the **Layer name** box is how the device
remembers a list. A spreadsheet suggests a name from its file name (`Fernhollow CERT 2026-10-15.xlsx`
suggests *Fernhollow CERT*); a Setup file brings its own. Import the next version under the same name
and, if people who were in the last version aren't in this one, RangerTrak asks:

> 2 people are no longer in Fernhollow CERT. Remove them?

It starts at **No, keep them**. **Yes** removes just those people. It never removes anyone another
list also has, anyone you added by hand, or anyone who was never in this list. Radio log entries that
name a removed person stay as they were, with the call sign as it was written. Leave the Layer name
blank and the import isn't remembered at all, which is how it worked before.

Under *Import, export & print*, **Layers on this device** lists what the device remembers: name,
as-of date, when it was imported and how many people it holds. **Remove this layer** asks first, then
removes the people only that layer brought in. Changes you made to those people on this device since
the import aren't tracked, so someone you edited is still removed.

**Importing several Setup files**: load them one after another on the Mission page (Data safety, Setup file).
Each shows its own preview first, and a later file wins where it matches someone an earlier one added.

**Printing the roster.** **Print roster**, beside Export on the Rangers page, prints a contact sheet
of the selected rows (or the rows the table shows): call sign, name, role, phone and ID, grouped by team.
It has names and phone numbers on it, so keep the paper safe.

**Places layer the same way.** Import your county's places, then your own group's, then a
mission's. A place with the **same name** as one already on the device is updated; any other
name is added. Radio log entries are never touched by any of these imports.

### Starting over

Sometimes you want a clean roster, not another layer: a new season, or a device borrowed from
another group. Choose **Replace roster…** when you import. RangerTrak asks you to confirm, then
removes the current roster and loads the file. Use **Export roster** first if you might want the
old one back.

**After an event,** people added or corrected at the desk are on that device only. Save them with
**Export changes** (under *Import, export & print*) and copy them into your own lists, so the next
import doesn't bring the old details back. The file is a spreadsheet with a *change* column
saying whether each person was added, edited or removed.

## 5. Add photos (optional)

A photo beside each name helps the scribe confirm who is calling in. Name each photo file after
the person's **Ranger ID**, or their call sign if they have no ID: for example `DM-0001.jpg` or
`WZ0HAZ.png`. Then use **Import photos** and pick them all at once. Photos stay on this device. **Export photos** saves the photos of the rows the roster export would take (see **All rows** beside it) as a .zip named the same way, which you can import again on another device.

## 6. Check it worked

- The Rangers page shows everyone, with the right IDs and call signs.
- On **Entry**, type a few names or call signs. Each should come up.
- **Back up mission** (on the Mission page) now saves the roster with everything else.

## 7. Keep it current

- **Keep one master copy** (your spreadsheet), and treat the copies on devices as copies.
- People added or corrected at the desk during an event come back with **Export changes**. Copy
  those changes into your master spreadsheet, then re-import it before the next event.
- **After an event**, delete the roster from devices that don't belong to your group.

## Keep it safe

Once it's filled in, your roster holds names, phone numbers and call signs. Keep the spreadsheet
on a computer you control, share it only with people who need it, and never post it anywhere
public. RangerTrak keeps the roster on each device unencrypted unless you turn on **Device
encryption** (Mission → Data safety).
