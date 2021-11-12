const DAY_MILLIS = 24 * 60 * 60 * 1000
const FIXED_MILLIS = DAY_MILLIS / 10_000

/**
 * Generates measurement values for a specific time.
 * @param period period of the generated data (days)
 * @param min minumum value
 * @param max maximum value excluding 0-1 random
 * @param time time for the generated value (millis)
 * @returns generated value
 */
function generateValue(period, min = 0, max = 40, time) {
  const dif = max - min
  // generate main value
  const periodValue =
    (dif / 4) *
    Math.sin((((time / FIXED_MILLIS) % period) / period) * 2 * Math.PI)
  // generate secondary value, which is lowest at noon
  const dayValue =
    (dif / 4) *
    Math.sin(((time % FIXED_MILLIS) / FIXED_MILLIS) * 2 * Math.PI - Math.PI / 2)
  return (
    Math.trunc((min + dif / 2 + periodValue + dayValue + Math.random()) * 10) /
    10
  )
}

module.exports = {
  generateValue,
}
