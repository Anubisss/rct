'use strict'

const request = require('request')
const _ = require('lodash')
const ejs = require('ejs')
const moment = require('moment')
const AWS = require('aws-sdk')
const winston = require('winston')

const ISIN_CODE_REGEX = /^([A-Z]{2})[A-Z0-9]{9}\d{1}$/

const INSTRUMENT_TYPES_TO_SAVE = [ 'Részvény', 'ETF' ]
const DATA_URL = 'https://randomcapital.hu/uploads/ik/basedata.json'

const TEMPLATE_PATH_TICKERS = './tickers.ejs'

const FINVIZ_SCREENER_URL = 'https://finviz.com/screener.ashx?v=111&t='

const HOST_S3_BUCKET_NAME = process.env.HOST_S3_BUCKET_NAME
const GA_TRACKING_ID = process.env.GA_TRACKING_ID

class InstrumentError extends Error {
  constructor(message, invalidElement) {
    super(message)

    this.name = `${ this.constructor.name }: ${ message }`
    this.invalidElement = invalidElement
  }
}

function LogFormatter(awsRequestId, options) {
  const { level, message: msg, meta } = options

  return JSON.stringify({
    level,
    msg,
    meta,
    awsRequestId,
  })
}

function createInstrument(instrumentRow) {
  return {
    ticker: instrumentRow[0],
    shortName: instrumentRow[1],
    longName: instrumentRow[2],
    isinCode: instrumentRow[3],
    type: instrumentRow[4],
  }
}

function normalizeTicker(ticker) {
  return ticker.replace(/ /g, '-')
}

function getInstrumentTypes(instruments) {
  return _.uniq(instruments.map(instrumentRow => createInstrument(instrumentRow).type))
}

function getInstrumentTypeCountries(instruments, instrumentType) {
  return _.uniq(
    instruments.filter(instrumentRow => createInstrument(instrumentRow).type === instrumentType)
      .map(instrumentRow => createInstrument(instrumentRow).isinCode.match(ISIN_CODE_REGEX)[1])
  )
}

function getInstrumentTickers(instruments, instrumentType, instrumentCountry, addSpace = true) {
  const instrumentTickers = instruments.filter(instrumentRow => createInstrument(instrumentRow).type === instrumentType)
    .filter(instrumentRow => createInstrument(instrumentRow).isinCode.match(ISIN_CODE_REGEX)[1] === instrumentCountry)
    .map(instrumentRow => createInstrument(instrumentRow).ticker)

  let tickersStr = ''
  instrumentTickers.forEach((ticker, i) => {
    tickersStr += normalizeTicker(ticker)
    if (i < instrumentTickers.length - 1) {
      tickersStr += ','
      if (addSpace) {
        tickersStr += ' '
      }
    }
  })
  return tickersStr
}

function getInstrumentsData() {
  winston.info('getInstrumentsData')
  return new Promise((resolve, reject) => {
    request.get(DATA_URL, (err, res, body) => {
      if (err) {
        reject(err)
      }
      else if (res.statusCode !== 200) {
        reject(new Error(`got non 200 response, status code: ${ res.statusCode }`))
      } else {
        resolve(body)
      }
    })
  })
}

function doParseAndValidation(body) {
  winston.info('doParseAndValidation')
  const parsedBody = JSON.parse(body)

  if (!_.isArray(parsedBody.data) || !parsedBody.data.length) {
    throw new InstrumentError('invalid data', parsedBody.data)
  }

  const instruments = parsedBody.data

  instruments.forEach(instrumentRow => {
    if (!_.isArray(instrumentRow) || instrumentRow.length !== 5) {
      throw new InstrumentError('invalid instrument row', instrumentRow)
    }

    const instrument = createInstrument(instrumentRow)

    if (!_.isString(instrument.ticker) || instrument.ticker.length < 1 || instrument.ticker.length > 12) {
      throw new InstrumentError('invalid instrument ticker', instrument.ticker)
    }
    if (!_.isString(instrument.shortName) || instrument.shortName.length < 2 || instrument.shortName.length > 24) {
      throw new InstrumentError('invalid instrument short name', instrument.shortName)
    }
    if (!_.isString(instrument.longName) || instrument.longName.length < 2 || instrument.longName.length > 64) {
      throw new InstrumentError('invalid instrument long name', instrument.longName)
    }
    if (!_.isString(instrument.isinCode) || !instrument.isinCode.match(ISIN_CODE_REGEX)) {
      throw new InstrumentError('invalid instrument ISIN code', instrument.isinCode)
    }
    if (!_.isString(instrument.type) || instrument.type.length > 24) {
      throw new InstrumentError('invalid instrument type', instrument.type)
    }
  })

  return instruments
}

function selectInstruments(instruments) {
  winston.info('selectInstruments')
  return instruments.filter(instrumentRow => INSTRUMENT_TYPES_TO_SAVE.indexOf(createInstrument(instrumentRow).type) !== -1)
}

function renderHtml(instruments) {
  winston.info('renderHtml')
  if (!instruments.length) {
    throw new Error('HTML renderer got 0 instruments')
  }

  const templateData = {
    generationDate: moment.utc().format('ll'),
    instrumentTypes: getInstrumentTypes(instruments),
    getInstrumentTypeCountries: getInstrumentTypeCountries.bind(null, instruments),
    getInstrumentTickers: getInstrumentTickers.bind(null, instruments),
    finvizScreenerUrl: FINVIZ_SCREENER_URL,
    gaTrackingId: GA_TRACKING_ID,
  }

  return new Promise((resolve, reject) => {
    ejs.renderFile(TEMPLATE_PATH_TICKERS, templateData, (err, res) => {
      if (err) {
        reject(err)
      } else {
        resolve(res)
      }
    })
  })
}

function uploadToS3(html) {
  winston.info('uploadToS3')
  return new AWS.S3().putObject({
    Bucket: HOST_S3_BUCKET_NAME,
    Key: 'tickers.html',
    Body: html,
    ContentType: 'text/html; charset=utf-8',
  }).promise()
}

function Handler(event, context, callback) {
  winston.remove(winston.transports.Console)
  winston.add(winston.transports.Console, {
    formatter: LogFormatter.bind(null, context.awsRequestId),
  })

  winston.info('starting', {
    nodeEnv: process.env.NODE_ENV,
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    timezoneOffset: new Date().getTimezoneOffset() / 60,
    hostS3BucketName: HOST_S3_BUCKET_NAME,
    googleAnalyticsEnabled: GA_TRACKING_ID ? true : false,
  })

  getInstrumentsData()
    .then(doParseAndValidation)
    .then(selectInstruments)
    .then(renderHtml)
    .then(uploadToS3)
    .then(() => {
      winston.info('tickers generated')
      callback(null, 'tickers generated')
    })
    .catch(err => {
      winston.error('error occured during tickers generation', err)
      callback(err)
    })
}

module.exports = {
  Handler,
}
