/**
 * Parses protocol lines into array of points having measurement, tags, keys, timestamp fields
 * @param {string|Buffer} data input data
 * @returns arrays of points
 */
function parseProtocolLines(data) {
  if (typeof data !== 'string') data = String(data)
  const result = []
  let start = 0
  let i = start

  while (i < data.length) {
    let measurement
    const tags = {}
    const fields = {}
    let timestamp

    // read measurement
    for (; i < data.length; i++) {
      const c = data[i]
      if (c === '\n') {
        start++
        continue
      }
      if (c === ' ' || c === ',') {
        measurement = data.substring(start, i)
        break
      }
    }
    // read tag key=value pairs
    if (data[i] === ',') {
      start = ++i
      let key
      readTags: for (; i < data.length; i++) {
        switch (data[i]) {
          case '=':
            key = data.substring(start, i)
            start = i + 1
            continue
          case ',':
            tags[key] = data.substring(start, i)
            start = i + 1
            continue
          case ' ':
            tags[key] = data.substring(start, i)
            break readTags
        }
      }
    }
    // read field key=value pairs
    if (data[i] === ' ') {
      start = ++i
      let key
      readField: for (; i < data.length; i++) {
        switch (data[i]) {
          case '=':
            key = data.substring(start, i)
            start = i + 1
            continue
          case ',':
            fields[key] = data.substring(start, i)
            start = i + 1
            continue
          case ' ':
            fields[key] = data.substring(start, i)
            break readField
        }
      }
    }
    // read timestamp
    if (data[i] === ' ') {
      start = i + 1
      while (i < data.length && data[i] !== '\n') i++
      timestamp = data.substring(start, i)
    }
    start = i
    result.push({
      measurement,
      tags,
      fields,
      timestamp,
    })
  }
  return result
}

module.exports = parseProtocolLines
