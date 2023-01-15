import { Browser } from '../Browser/browser.js'
import { BookMetadata } from './book-metadata.js'
import { Chapter } from './chapter.js'
import PromiseThrottle from 'promise-throttle'
import { eventEmitter } from '../Events/event-emitter.js'
import { chapterLoadingStarted, ChapterLoadingStartedEvent } from '../Events/chapter-loading-started-event.js'
import { chapterLoaded, ChapterLoadedEvent } from '../Events/chapter-loaded-event.js'

const allChaptersPath = '/wp-admin/admin-ajax.php'

/**
 * @property {URL} url
 */
export class Book {
  /**
   * @param {URL} url
   */
  constructor (url) {
    this.url = url
  }

  /**
   * @returns {Promise<BookMetadata>}
   */
  async getBookMetaData () {
    if (this._bookMetaData === undefined) {
      this._bookMetaData = new BookMetadata()
      await this._bookMetaData.load(await this.getPage())
    }
    return this._bookMetaData
  }

  /**
   * @private
   */
  async getPage () {
    if (this._page === undefined) {
      this._page = await Browser.newPage()
      await this._page.goto(this.url.toString())
    }

    return this._page
  }

  /**
   * @returns {Promise<Chapter[]>}
   */
  async getChapters () {
    if (this._chapters === undefined) {
      const chapterUrls = await this.getChapterUrls()

      const promiseThrottle = new PromiseThrottle({
        requestsPerSecond: 5,
      })
      eventEmitter.emit(chapterLoadingStarted, new ChapterLoadingStartedEvent(chapterUrls.length))
      const chapters = Array(chapterUrls.length)
      this._chapters = promiseThrottle.addAll(
        chapterUrls.map(
          (url, order) => async () => {
            const chapter = new Chapter()
            await chapter.load(url)
            chapters[order] = chapter
            eventEmitter.emit(chapterLoaded, new ChapterLoadedEvent(chapter))
            return chapter
          })
      )
    }

    return this._chapters
  }

  /**
   * @private
   * @returns {Promise<URL[]>}
   */
  async getChapterUrls () {
    const page = await Browser.newPage()
    const response = await Browser.sendPostRequest(page, this.url.origin + allChaptersPath, new URLSearchParams({
      action: 'wi_getreleases_pagination',
      pagenum: -1,
      mypostid: (await this.getBookMetaData()).postId
    }).toString())
    await page.setContent(await response.text())

    const urlStrings = await page.$$eval(
      '.toc_w',
      (chapterNodes) =>
        chapterNodes
          .sort((nodeA, nodeB) => (
            Math.sign(parseInt(nodeA.getAttribute('order'), 10) - parseInt(nodeB.getAttribute('order'), 10)))
          )
          .map((chapterNode) => chapterNode.querySelector('.toc_a').getAttribute('href'))
    )
    return urlStrings.map((urlString) => new URL(urlString))
  }
}