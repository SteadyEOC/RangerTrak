//import { Injectable, OnInit } from '@angular/core';
//import { JSONSchema, LocalStorage, StorageMap } from '@ngx-pwa/local-storage';

import { UpperCasePipe } from '@angular/common'

// Sprint H: MGRS/UTM/Maidenhead - the coordinate systems SAR, wildland fire, and the
// National Guard actually use over voice radio. See PRIVATE-Roadmap.md Sprint H.
import { forward as mgrsForward, toPoint as mgrsToPoint } from 'mgrs'
import { fromLatLon as utmFromLatLon, toLatLon as utmToLatLon } from 'utm'

// See also Google's own coordinate conventions, for comparison:
// https://developers.google.com/maps/documentation/javascript/coordinates
// https://developers.google.com/maps/documentation/javascript/reference/coordinates

const id = "Coordinate Utility"

export enum DirEnum {
  E = 'East',
  W = 'West',
  N = 'North',
  S = 'South'
}
export type DirType = 'E' | 'W' | 'N' | 'S'

class PointSample {
  constructor(private _age: number,
    private _firstName: string,
    private _lastName: string) {
  }
}

export class Coordinate_Unused {
  constructor(private _lat: number, private _long: number) {
    // TODO: Force all values to X%180 or Y%90 ?
    if (_lat < -180 || _lat > 180)
      throw new Error('latatude is over 180 or under -180 degrees.')
    if (_long < -180 || _long > 180)
      throw new Error('longitude is over 180 or under -180 degrees.')
    //this.lat = lat;
    //this.long = long;
  }

  toString(): string {
    return "lat: " + this._lat +
      "; long: " + this._long
  }

  public get Point() {
    return (this._lat, this._long);
  }

  //toDMS(ptDD: PointDD) {  }

  // Save to disk or ...
  serialize(name: string) {
    ;
  }

  load(name: string) {
    ;
  }
}


// Get object {deg:, min:, sec:, dir:}
// sec truncated to two digits (e.g. 3.14)
// dir returns S or N if lng = false (for latitudes)
// dir returns E or W if lng (longitude) = true
// N.B.: may not work for angles between -1° and 0°
// from www.stackoverflow.com/questions/5786025
// https://www.pgc.umn.edu/apps/convert/
// https://flyandwire.com/2020/08/10/back-to-basics-latitude-and-longitude-dms-dd-ddm/
// https://www.igismap.com/conversion-of-degree-minute-seconds-degree-decimal-minutes-decimal-degree-format-latitude-longitude/
// https://www.earthref.org/content/where-world-are-you-degrees-vs-degrees-minutes-and-seconds
// https://www.cumulations.com/blog/latitude-and-longitude/

export function DDToDMS(D: number, lng: boolean = false) {
  /*
  if (!D) {
      this.log.verbose("Invalid number received for Decimal Degrees!", this.id)
      return Number.NaN
  }
  */
  /*
    this.log.verbose("DDtoDMS: D=" + D + " lng=" + lng, this.id)
    let dirr = D<0?lng?'W':'S':lng?'E':'N'
    let degg = 0|(D<0?D=-D:D)
    let minn = 0|D%1*60
    let secc = (0|D*60%1*6000)/100
    this.log.verbose("DDtoDMS: dir=" + dirr + " deg=" + degg + " min" + minn + " sec=" + secc, this.id)
  */
  return {
    dir: D < 0 ? lng ? 'W' : 'S' : lng ? 'E' : 'N',
    deg: 0 | (D < 0 ? D = -D : D),
    min: 0 | D % 1 * 60,
    sec: 0 | (Math.round(D * 60 % 1 * 6000) / 100)
  }
}

/**
 * Convert DMS to Deg and Decimal minutes
 * Get object {deg:, min:, dir:}
 * min truncated to 4 digits (e.g. 3.1432)
 * dir returns S or N if lng = false (i.e., latitudes)
 * dir returns E or W if lng = true  (a longitude)
 * from https://www.cumulations.com/blog/latitude-and-longitude/
 * https://www.igismap.com/conversion-of-degree-minute-seconds-degree-decimal-minutes-decimal-degree-format-latitude-longitude/
 * https://www.earthref.org/content/where-world-are-you-degrees-vs-degrees-minutes-and-seconds
 * https://www.fcc.gov/media/radio/dms-decimal
 * @param D
 * @param lng
 * @returns
 */

export function DDToDDM(D: number, lng: boolean = false) {
  return {
    dir: D < 0 ? lng ? 'W' : 'S' : lng ? 'E' : 'N',
    deg: 0 | (D < 0 ? D = -D : D),
    min: 0 | Math.round((D % 1) * 60000) / 10
  }
}


/**
 * Convert DMS to Deg and Decimal minutes
 * Get object {deg:, min:, dir:}
 * min truncated to 4 digits (e.g. 3.1432)
 * dir returns S or N if lng = false (i.e., latitudes)
 * dir returns E or W if lng = true  (a longitude)
 * https://www.igismap.com/conversion-of-degree-minute-seconds-degree-decimal-minutes-decimal-degree-format-latitude-longitude/
 * @param D
 * @param M
 * @param S
 * @param Q
 * @returns number
 */
export function DMSToDD(Q: string, D: number, M: number, S: number): number {
  console.info(`DMSToDD got:  ${D}° ${M}' ${S}" ${Q}`)
  return (((Q.toLowerCase() == 'w' || Q.toLowerCase() == 's') ? -1 : 1) * (D
    + Math.round((M / 60 + S / 6000) * (10 ** 4)) / (10 ** 4))) // float portion to 4 decimals
  //+ Number(Math.round((M / 60 + S / 6000) * (10 ** 4)).toFixed(4)))  // alternatively
}

/**
 * Convert DDM to Deg and Decimal minutes
 * Get object {deg:, min:, dir:}
 * min truncated to 4 digits (e.g. 3.1432)
 * dir returns S or N if lng = false (i.e., latitudes)
 * dir returns E or W if lng = true  (a longitude)
 * https://www.igismap.com/conversion-of-degree-minute-seconds-degree-decimal-minutes-decimal-degree-format-latitude-longitude/
 * @param D
 * @param M
 * @param Q
 *
 * @returns number
 */

export function DDMToDD(Q: string, D: number, M: number) {
  // console.info(`DDMToDD got:  ${D}° ${M} ' ${Q}`)
  return (((Q.toLowerCase() == 'w' || Q.toLowerCase() == 's') ? -1 : 1) * (D
    + Math.round((M / 60) * 10 ** 4) / 10 ** 4)) // float portion to 4 decimals
}

/**
 * Convert Decimal Degrees to MGRS, split for entry as three fields (Grid Reference,
 * Easting, Northing) rather than one opaque string - matches how MGRS is actually
 * read aloud over radio (zone/square as one chunk, then two digit groups), and keeps
 * the same "split by component" convention DD/DDM/DMS already use.
 *
 * accuracy=5 (1m precision) gives a 5-digit easting and 5-digit northing - the `mgrs`
 * package concatenates zone+band+100km-square+easting+northing into one string with
 * no separators, so gridRef is "everything except the last 10 digits".
 *
 * @param lat
 * @param lng
 */
export function DDToMGRS(lat: number, lng: number): { gridRef: string; easting: number; northing: number } {
  const full = mgrsForward([lng, lat], 5)
  const digits = 10 // 5-digit easting + 5-digit northing at accuracy 5
  return {
    gridRef: full.slice(0, full.length - digits),
    easting: Number(full.slice(full.length - digits, full.length - digits / 2)),
    northing: Number(full.slice(full.length - digits / 2)),
  }
}

/**
 * Convert MGRS (as the three split fields above) back to Decimal Degrees.
 * Returns null for a gridRef/easting/northing combination the `mgrs` package rejects.
 */
export function MGRSToDD(gridRef: string, easting: number, northing: number): { lat: number; lng: number } | null {
  try {
    const eastingStr = String(Math.trunc(easting)).padStart(5, '0')
    const northingStr = String(Math.trunc(northing)).padStart(5, '0')
    const [lng, lat] = mgrsToPoint(`${gridRef}${eastingStr}${northingStr}`)
    return { lat, lng }
  } catch {
    return null // invalid grid reference - let the caller's validation handle it
  }
}

/**
 * Convert Decimal Degrees to UTM, split as Zone/Hemisphere/Easting/Northing.
 *
 * Hemisphere is a plain N/S letter - the same idiom the DDM/DMS lat-direction fields
 * already use - rather than the `utm` package's own latitude-BAND letter (e.g. 'T'),
 * which would force users to learn a second letter system just to enter a position.
 * Computed directly from the sign of `lat`, not from the package's own zoneLetter.
 *
 * @param lat
 * @param lng
 */
export function DDToUTM(lat: number, lng: number): { zone: number; hemisphere: string; easting: number; northing: number } {
  const { easting, northing, zoneNum } = utmFromLatLon(lat, lng)
  return {
    zone: zoneNum,
    hemisphere: lat >= 0 ? 'N' : 'S',
    easting: Math.round(easting),
    northing: Math.round(northing),
  }
}

/**
 * Convert UTM (Zone/Hemisphere/Easting/Northing) back to Decimal Degrees.
 * Returns null for values the `utm` package rejects (e.g. easting/northing out of
 * range for the given zone).
 */
export function UTMToDD(zone: number, hemisphere: string, easting: number, northing: number): { lat: number; lng: number } | null {
  try {
    const { latitude, longitude } = utmToLatLon(easting, northing, zone, undefined, hemisphere.toUpperCase() === 'N')
    return { lat: latitude, lng: longitude }
  } catch {
    return null
  }
}

// Maidenhead grid locator (used natively by ARES/RACES ham operators). Field (18
// letters A-R, each 20°lon x 10°lat) + Square (10 digits 0-9, each 2°lon x 1°lat) +
// Subsquare (24 letters a-x, each 5'lon x 2.5'lat) = 6-character precision, the level
// most ham operators actually use. No dependency - this is the entire algorithm.
const MAIDENHEAD_FIELD = 'ABCDEFGHIJKLMNOPQR'
const MAIDENHEAD_SUBSQUARE = 'abcdefghijklmnopqrstuvwx'
const MAIDENHEAD_PATTERN = /^[A-Ra-r]{2}[0-9]{2}([A-Xa-x]{2})?$/

export function DDToMaidenhead(lat: number, lng: number): string {
  let lonRemainder = lng + 180 // 0..360
  let latRemainder = lat + 90  // 0..180

  const fieldLon = Math.floor(lonRemainder / 20)
  const fieldLat = Math.floor(latRemainder / 10)
  lonRemainder -= fieldLon * 20
  latRemainder -= fieldLat * 10

  const squareLon = Math.floor(lonRemainder / 2)
  const squareLat = Math.floor(latRemainder / 1)
  lonRemainder -= squareLon * 2
  latRemainder -= squareLat * 1

  const subLon = Math.floor(lonRemainder / (2 / 24))
  const subLat = Math.floor(latRemainder / (1 / 24))

  return MAIDENHEAD_FIELD[fieldLon] + MAIDENHEAD_FIELD[fieldLat]
    + squareLon + squareLat
    + MAIDENHEAD_SUBSQUARE[subLon] + MAIDENHEAD_SUBSQUARE[subLat]
}

/** Returns null for anything that isn't a well-formed 4- or 6-character locator. */
export function MaidenheadToDD(locator: string): { lat: number; lng: number } | null {
  if (!MAIDENHEAD_PATTERN.test(locator)) return null

  const upper = locator.toUpperCase()
  const fieldLon = upper.charCodeAt(0) - 65 // 'A'
  const fieldLat = upper.charCodeAt(1) - 65
  const squareLon = Number(upper[2])
  const squareLat = Number(upper[3])

  let lng = fieldLon * 20 + squareLon * 2 - 180
  let lat = fieldLat * 10 + squareLat * 1 - 90

  if (upper.length >= 6) {
    // Center of the subsquare
    const subLon = upper.charCodeAt(4) - 65 // 'A'
    const subLat = upper.charCodeAt(5) - 65
    lng += (subLon + 0.5) * (2 / 24)
    lat += (subLat + 0.5) * (1 / 24)
  } else {
    // Center of the 2°x1° square
    lng += 1
    lat += 0.5
  }

  return { lat, lng }
}

/** True if `text` looks like a Maidenhead grid locator - checked ahead of the street-
 * address fallback in location.component.ts's onAddressChg(), the same way Plus Codes
 * and What3Words are already detected there. */
export function isMaidenhead(text: string): boolean {
  return MAIDENHEAD_PATTERN.test(text)
}

// Mean Earth radius, metres - the standard constant for this spherical-Earth formula. Not
// precise enough for surveying, more than precise enough for a SAR range-and-bearing call
// ("200m north of here") over the distances this is ever used at.
const EARTH_RADIUS_M = 6371000

/**
 * Architecture decision, 2026-08-26: evidence/clue location is entered as a range and
 * bearing FROM the reporter's own position, not a second full coordinate - this is how it
 * is actually communicated over radio in practice ("I'm at grid B4, found a boot about 200m
 * north of here"), not by reading a second GPS fix at the clue's own location. This is the
 * standard "destination point given distance and bearing" spherical-trig formula (the same
 * one behind every "vincenty/haversine destination" reference implementation), computing the
 * resulting absolute lat/lng so the rest of the app (storage, the map marker) never needs to
 * know range-and-bearing was how it was entered.
 */
export function destinationPoint(originLat: number, originLng: number, distanceMeters: number, bearingDegrees: number): { lat: number, lng: number } {
  const δ = distanceMeters / EARTH_RADIUS_M // angular distance
  const θ = bearingDegrees * Math.PI / 180
  const φ1 = originLat * Math.PI / 180
  const λ1 = originLng * Math.PI / 180

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  )

  return {
    lat: φ2 * 180 / Math.PI,
    lng: ((λ2 * 180 / Math.PI) + 540) % 360 - 180, // normalise to -180..180
  }
}

/**
 * The inverse of destinationPoint() above: given an origin and an absolute destination,
 * the range-and-bearing FROM the origin TO it. E-105 (2026-08-27): backs the evidence-
 * location map click - a scribe places a marker directly at the clue instead of typing a
 * distance/bearing they'd otherwise have to estimate by eye, and this converts that click
 * back into the same distance/unit/bearing model EvidenceLocationComponent already owns,
 * so the rest of that component (computedLocation, the emitted LocationType) is unchanged.
 * Standard haversine distance + initial-bearing formulas, same spherical-Earth assumption
 * and EARTH_RADIUS_M constant as destinationPoint() - accurate enough for this use, not
 * for surveying.
 */
export function bearingAndDistance(originLat: number, originLng: number, destLat: number, destLng: number): { distanceMeters: number, bearingDegrees: number } {
  const φ1 = originLat * Math.PI / 180
  const φ2 = destLat * Math.PI / 180
  const Δφ = (destLat - originLat) * Math.PI / 180
  const Δλ = (destLng - originLng) * Math.PI / 180

  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distanceMeters = EARTH_RADIUS_M * c

  const θ = Math.atan2(
    Math.sin(Δλ) * Math.cos(φ2),
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  )
  const bearingDegrees = (θ * 180 / Math.PI + 360) % 360

  return { distanceMeters, bearingDegrees }
}


/*
Use Google.geocode instead
export function AddressToDD(newAddress: string) {
  let lat = 0
  let lng = 0

  return { lat: lat, lng: lng }
}
*/


// #81 finding (confirmed dead - see the roadmap list): unused anywhere in src/, duplicates a
// function in the Utility class, and returns a google.maps.LatLng despite Google Maps having
// been removed from this app. Left as-is here (comment-only pass); a safe delete candidate.
export function strToLatLng_Unused(str: string) {
  const latlngStr = str.split(",", 2);
  return new google.maps.LatLng(parseFloat(latlngStr[0]), parseFloat(latlngStr[1]))
}

// Coord is a lat or lng in decimal degrees
class Coord_Unused {
  constructor(public coord: number) {
    try {
      // TODO: Could map larger/smaller values using modulus
      // coord = coord % 360.0
      if (isNaN(coord)) throw "Coordinate is not a number"
      if (coord < -180) throw "Coordinate under -180 degrees."
      if (coord > 180) throw "Coordinate over 180 degrees."
      // this.log.excessive("Coordinate passed range check...", this.id)
    }
    catch (err: unknown) {
      // this.log.verbose("Bad Coordinate at Coord(): " + err.message, this.id)
    }
  }
  // Get object {deg:, min:, sec:, dir:}
  // sec truncated to two digits (e.g. 3.14)
  // dir returns S or N if lng = false (for latitudes)
  // dir returns E or W if lng (longitude) = true
  // N.B.: may not work for angles between -1° and 0°
  // from www.stackoverflow.com/questions/5786025
  /*
  ToDMS(lng: boolean): CoordDMS {
    return new CoordDMS(
      this.coord < 0 ? lng ? Direction.W : Direction.S : lng ? Direction.E : Direction.N,
      0 | (this.coord < 0 ? this.coord = -this.coord : this.coord),
      0 | this.coord % 1 * 60,
      (0 | this.coord * 60 % 1 * 6000) / 100
    )
  }

  ToNumber(): number {
     return this.coord
  }
  */
}

