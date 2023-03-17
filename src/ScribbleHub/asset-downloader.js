import fs from 'fs'
import path from 'path'
import stream from 'stream'
import { assetAlreadyDownloaded, AssetAlreadyDownloadedEvent } from '../Events/asset-already-download.js'
import { assetDownloadFinished, AssetDownloadFinishedEvent } from '../Events/asset-download-finished.js'
import { assetDownloadStarted, AssetDownloadStartedEvent } from '../Events/asset-download-started.js'
import { eventEmitter } from '../Events/event-emitter.js'

export class AssetDownloader {
  /**
   * @param {Promise<string>} cacheDir
   */
  constructor (cacheDir) {
    this._cacheDir = cacheDir
  }

  /**
   * @param {cheerio} $
   * @param {string} selector
   * @returns {Promise<void>}
   */
  async fetchImagesFromQuery ($, selector) {
    const urls = (await Promise.all($(selector)
      .map(async (i, image) => {
        const $image = $(image)
        const urlString = $image.attr('src')
        if (!urlString) {
          return
        }
        const url = new URL(urlString)
        $image.attr('src', await this.mapFilePath(url))

        return url
      }))).filter((url) => !!url)

    await Promise.all(urls.map(async (url) => {
      if (!url) {
        return
      }
      await this.download(url)
    }))
  }

  /**
   * @param {URL} url
   * @returns {Promise<string>}
   */
  async mapFilePath (url) {
    return path.resolve(await this._cacheDir, url.pathname.replace(/^\//, ''))
  }

  /**
   * @param {URL} url
   * @returns {Promise<string>} file path
   */
  async download (url) {
    const filePath = await this.mapFilePath(url)
    if (fs.existsSync(filePath)) {
      eventEmitter.emit(assetAlreadyDownloaded, new AssetAlreadyDownloadedEvent(filePath))
      return filePath
    }

    const dirName = path.dirname(filePath)
    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
    }

    eventEmitter.emit(assetDownloadStarted, new AssetDownloadStartedEvent(url, filePath))
    await this.saveImageToDisk(url, filePath)
    eventEmitter.emit(assetDownloadFinished, new AssetDownloadFinishedEvent(url, filePath))

    return filePath
  }

  /**
   * @private
   * @param {URL} url
   * @param {string} filePath
   */
  async saveImageToDisk (url, filePath) {
    const response = await fetch(url.toString())
    const fileStream = fs.createWriteStream(filePath)
    await stream.promises.finished(stream.Readable.fromWeb(response.body).pipe(fileStream))
  }
}
