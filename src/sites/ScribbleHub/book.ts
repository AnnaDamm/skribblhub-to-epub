import * as cheerio from 'cheerio'
import fs from 'fs'
import path from 'path'
import { throttleAll } from 'promise-throttle-all'
import { Memoize } from 'typescript-memoize';
import { chapterLoadingFinished, ChapterLoadingFinishedEvent } from '../../Events/chapter-loading-finished.js'
import { chapterLoadingStarted, ChapterLoadingStartedEvent } from '../../Events/chapter-loading-started.js'
import { eventEmitter } from '../../Events/event-emitter.js'
import { MainPageLoaded, mainPageLoaded } from '../../Events/main-page-loaded.js'
import { AssetDownloader } from '../Base/asset-downloader.js'
import { Book as BookModel } from '../Base/book.models.js';
import { BookMetadata } from './book-metadata.model.js';
import { Chapter } from './chapter.js'
import { MetadataLoader } from './metadata-loader.js';

const allChaptersPath = '/wp-admin/admin-ajax.php'

export class Book implements BookModel {
    private readonly startingChapterUrl: URL | undefined;

    constructor(
        public url: URL,
        private readonly cacheDir: string
    ) {
        if (this.isChapterUrl(url)) {
            this.startingChapterUrl = url;
        }
    }

    @Memoize()
    public async getBookMetaData(): Promise<BookMetadata> {
        const bookMetadata = await new MetadataLoader().load(this.url)
        eventEmitter.emit(mainPageLoaded, new MainPageLoaded(bookMetadata))
        return bookMetadata
    }

    @Memoize()
    public async getCover(): Promise<string> {
        await this.init();
        const bookMetaData = await this.getBookMetaData()
        return await this.assetDownloader.download(bookMetaData.coverUrl)
    }

    @Memoize()
    public async getChapters(startWith: number, endWith: number | undefined): Promise<Chapter[]> {
        await this.init()
        let chapterUrls = (await this.getChapterUrls())
        if (this.startingChapterUrl !== undefined) {
            startWith = chapterUrls.findIndex(
                (url) => url.toString() === this.startingChapterUrl!.toString()
            ) + 1
        }
        chapterUrls = chapterUrls.slice(startWith - 1, endWith)

        const cacheDir = this.getCacheDir()

        eventEmitter.emit(chapterLoadingStarted, new ChapterLoadingStartedEvent(chapterUrls.length))
        const chapters = throttleAll(50, chapterUrls.map((url, index) => async () => {
            const chapter = new Chapter(url, index + startWith, await cacheDir, this.assetDownloader)
            return chapter.load()
        }))
        chapters.then((chapters) => {
            eventEmitter.emit(chapterLoadingFinished, new ChapterLoadingFinishedEvent(chapters))
        })
        return chapters
    }

    private async getChapterUrls(): Promise<URL[]> {
        const response = await fetch(this.url.origin + allChaptersPath, {
            method: 'POST',
            body: new URLSearchParams({
                action: 'wi_getreleases_pagination',
                pagenum: '-1',
                mypostid: (await this.getBookMetaData()).postId.toString()
            })
        })
        const $ = cheerio.load(await response.text())
        return (<{ order: number, url: URL }[]>(<unknown>$('.toc_w')
            .map((_, node) => {
                const order = $(node).attr('order');
                const url = $(node).find('.toc_a').attr('href');
                if (!order || !url) {
                    return undefined;
                }
                return {
                    order: parseInt(order),
                    url: new URL(url)
                }
            }).filter(Boolean)
            .toArray()))
            .sort((chapterA, chapterB) => Math.sign(chapterA.order - chapterB.order))
            .map((chapter) => chapter.url)
    }

    @Memoize()
    private async getCacheDir(): Promise<string> {
        const directory = path.resolve(this.cacheDir, (await this.getBookMetaData()).slug)
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, {recursive: true})
        }
        return directory
    }

    @Memoize()
    private async init(): Promise<void> {
        if (this.startingChapterUrl !== undefined) {
            const page = await fetch(this.url.toString())
            const $ = cheerio.load(await page.text())
            const url = $('.c_index a').attr('href');
            if (!url) {
                throw new Error('could not find canonical url');
            }
            this.url = new URL(url)
        } else if (!this.isMainUrl(this.url)) {
            throw Error('Not a valid scribblehub url')
        }
    }

    @Memoize()
    private get assetDownloader(): AssetDownloader {
        return new AssetDownloader(this.getCacheDir());
    }

    private isChapterUrl(url: URL): boolean {
        return url.toString().match(/^https:\/\/www\.scribblehub\.com\/read\/.+\/chapter\/\d+\/$/) !== null
    }

    private isMainUrl(url: URL): boolean {
        return url.toString().match(/^https:\/\/www\.scribblehub\.com\/series\/\d+\/.+\/$/) !== null
    }
}
