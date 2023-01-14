import {Browser} from "../Browser/browser.js";

export class MainPage {
    /**
     * @param {URL} url
     */
    constructor(url) {
        this.url = url;
    }

    async loadMainPage() {
        await Browser.wrapPage(async (page) => {
            const response = await page.goto(this.url.toString());
            console.log(response.status(), await response.text());
        });
    }
}
