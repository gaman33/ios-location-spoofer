/* Local fix of the stateless settings interceptor. Keeps existing picker URLs and keys. */
(function () {
  "use strict";

  var isQuanX = typeof $task !== "undefined";

  function readKey(key) {
    try {
      return isQuanX ? $prefs.valueForKey(key) : $persistentStore.read(key);
    } catch (err) {
      return null;
    }
  }

  function writeVerified(key, value) {
    value = String(value);
    try {
      var ok = isQuanX ? $prefs.setValueForKey(value, key) : $persistentStore.write(value, key);
      return ok === true && readKey(key) === value;
    } catch (err) {
      return false;
    }
  }

  function parseQuery(url) {
    var out = Object.create(null);
    var qi = url.indexOf("?");
    if (qi < 0) return out;
    var parts = url.slice(qi + 1).split("&");
    for (var i = 0; i < parts.length; i += 1) {
      if (!parts[i]) continue;
      var eq = parts[i].indexOf("=");
      var key = decodeURIComponent((eq < 0 ? parts[i] : parts[i].slice(0, eq)).replace(/\+/g, " "));
      var value = decodeURIComponent((eq < 0 ? "" : parts[i].slice(eq + 1)).replace(/\+/g, " "));
      if (Object.prototype.hasOwnProperty.call(out, key)) throw new Error("duplicate parameter: " + key);
      out[key] = value;
    }
    return out;
  }

  function finiteNum(value) {
    if (value == null) return NaN;
    var text = String(value).trim();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return NaN;
    var n = Number(text);
    return isFinite(n) ? n : NaN;
  }

  function coordinatesValid(lat, lon) {
    return isFinite(lat) && Math.abs(lat) <= 90 && isFinite(lon) && Math.abs(lon) <= 180;
  }

  function optionalNumber(q, shortKey, key, nonnegative) {
    var value = q[shortKey] != null ? q[shortKey] : q[key];
    if (value == null || value === "") return null;
    var n = finiteNum(value);
    if (!isFinite(n) || Math.abs(n) > 9007199254740991 || (nonnegative && n < 0)) {
      throw new Error("invalid " + key);
    }
    return Math.round(n);
  }

  function respond(status, result) {
    var headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS"
    };
    var body = status === 204 ? "" : JSON.stringify(result);
    if (isQuanX) {
      var reasons = { 200: "OK", 204: "No Content", 400: "Bad Request", 405: "Method Not Allowed", 503: "Service Unavailable" };
      $done({ status: "HTTP/1.1 " + status + " " + reasons[status], headers: headers, body: body });
    } else {
      $done({ response: { status: status, headers: headers, body: body } });
    }
  }

  var request = typeof $request !== "undefined" && $request ? $request : {};
  var method = String(request.method || "").toUpperCase();
  if (method === "OPTIONS") {
    respond(204, null);
    return;
  }
  if (method !== "GET") {
    respond(405, { success: false, error: "method not allowed" });
    return;
  }

  var q;
  try {
    q = parseQuery(String(request.url || ""));
  } catch (err) {
    respond(400, { success: false, error: "invalid query parameters" });
    return;
  }
  var action = q.action == null ? "save" : q.action;
  if (action !== "save" && action !== "query" && action !== "clear") {
    respond(400, { success: false, error: "invalid action" });
    return;
  }
  if (action === "query") {
    var savedLat = finiteNum(readKey("latitude"));
    var savedLon = finiteNum(readKey("longitude"));
    if (!coordinatesValid(savedLat, savedLon)) {
      respond(200, { success: false, error: "No valid saved coordinates" });
      return;
    }
    var result = { success: true, latitude: savedLat, longitude: savedLon, enabled: readKey("enabled") === "true" };
    var optional = ["altitude", "horizontalAccuracy", "verticalAccuracy"];
    for (var j = 0; j < optional.length; j += 1) {
      var n = finiteNum(readKey(optional[j]));
      result[optional[j]] = isFinite(n) ? n : null;
    }
    respond(200, result);
    return;
  }
  if (action === "clear") {
    var cleared = writeVerified("enabled", "false");
    respond(cleared ? 200 : 503, cleared ? { success: true } : { success: false, error: "failed to disable saved coordinates" });
    return;
  }

  var lat = finiteNum(q.lat != null ? q.lat : q.latitude);
  var lon = finiteNum(q.lon != null ? q.lon : q.longitude);
  if (!coordinatesValid(lat, lon)) {
    respond(400, { success: false, error: "invalid latitude/longitude" });
    return;
  }
  var updates = { latitude: lat, longitude: lon };
  try {
    var alt = optionalNumber(q, "alt", "altitude", false);
    var hacc = optionalNumber(q, "hacc", "horizontalAccuracy", true);
    var vacc = optionalNumber(q, "vacc", "verticalAccuracy", true);
    if (alt != null) updates.altitude = alt;
    if (hacc != null) updates.horizontalAccuracy = hacc;
    if (vacc != null) updates.verticalAccuracy = vacc;
  } catch (err) {
    respond(400, { success: false, error: err.message });
    return;
  }

  // Existing multi-key storage has no transaction API. Disable and verify first;
  // only enable after every write and the final coordinate readback succeed.
  if (!writeVerified("enabled", "false")) {
    respond(503, { success: false, error: "cannot disable before saving" });
    return;
  }
  var keys = Object.keys(updates);
  var ok = true;
  for (var k = 0; k < keys.length; k += 1) {
    if (!writeVerified(keys[k], updates[keys[k]])) { ok = false; break; }
  }
  if (ok) {
    for (var m = 0; m < keys.length; m += 1) {
      if (readKey(keys[m]) !== String(updates[keys[m]])) { ok = false; break; }
    }
  }
  if (ok) ok = writeVerified("enabled", "true");
  if (!ok) {
    var disabled = writeVerified("enabled", "false");
    respond(503, { success: false, error: "storage verification failed", disabled: disabled });
    return;
  }
  var saved = { success: true };
  for (var p = 0; p < keys.length; p += 1) saved[keys[p]] = updates[keys[p]];
  respond(200, saved);
})();
