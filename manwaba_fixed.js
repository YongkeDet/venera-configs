/**
 * 漫蛙吧：图片解密、分类与搜索优化版（2026-10-21）
 * 基于 venera-app/venera-configs 的 manwaba.js 1.0.3。
 * 图片加密格式参考 AXmishell 在 PR #314 的提交：
 * https://github.com/venera-app/venera-configs/pull/314
 * commit: 5a6ee5fe9cce7da56d310768d5c7c37e3d71aeff
 *
 * 导入：漫画源 -> 使用配置文件 -> 选择本文件。
 * 导入后，从“漫蛙吧（图片修复版）”搜索并打开漫画。
 * 使用独立 key，旧收藏和阅读历史仍关联原来的漫蛙源。
 * GitHub 托管版：可从配置内的 url 获取后续更新。
 * 1.0.6：分类直连当前域名；使用 dart:io 保留 POST 并处理 301/302/307/308。
 * 1.0.7：搜索输入处理、无结果时回退关键词、相关性排序、去重和分页兼容。
 * 搜索优化经过本地回归测试；未完成在线搜索实测。
 */
class ManWaBa extends ComicSource {
  // Note: The fields which are marked as [Optional] should be removed if not used

  // name of the source
  name = "漫蛙吧（图片修复版）";

  // unique id of the source
  key = "manwaba_imagefix";

  version = "1.0.7";

  minAppVersion = "1.4.0";

  // 从个人仓库更新，保留修复源的 key。
  url = "https://raw.githubusercontent.com/YongkeDet/venera-configs/main/manwaba_fixed.js";

  //修改域名不能用问题
  api = "https://mwuu.cc/api";

  // 分类单独直连当前域名，绕开旧域名跳转时 POST 被转为 GET 的问题。
  categoryApi = "https://manwaxu.cc/api";

  // 只识别明确的图片文件头，避免把错误页面或密文当成图片。
  isImageData(bytes) {
    const matches = (offset, signature) =>
      bytes.length >= offset + signature.length &&
      signature.every((value, index) => bytes[offset + index] === value);
    return (
      matches(0, [0xff, 0xd8, 0xff]) ||
      matches(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
      (matches(0, [0x52, 0x49, 0x46, 0x46]) &&
        matches(8, [0x57, 0x45, 0x42, 0x50])) ||
      matches(0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
      matches(0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    );
  }

  decodeImageResponse(buffer) {
    // 兼容 ArrayBuffer 和带 byteOffset 的 TypedArray。
    const bytes = ArrayBuffer.isView(buffer)
      ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new Uint8Array(buffer);
    if (this.isImageData(bytes)) {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }

    let prefix = "";
    for (let i = 0; i < Math.min(bytes.length, 128); i++) {
      prefix += String.fromCharCode(bytes[i]);
    }
    if (/^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b|<\?xml\b|<Error\b|\{\s*"(?:error|code|message)"\s*:)/i.test(prefix)) {
      throw new Error("漫蛙图片服务器返回了错误页或验证页，请检查网络并重试。");
    }

    // CDN 格式：16 字节 IV + AES-256-CBC 密文，使用 PKCS#7 填充。
    if (bytes.length < 32 || (bytes.length - 16) % 16 !== 0) {
      throw new Error("漫蛙图片数据长度异常，可能是下载不完整或服务器返回了错误内容。");
    }
    let decrypted;
    try {
      decrypted = new Uint8Array(Convert.decryptAesCbc(
        bytes.slice(16).buffer,
        Convert.encodeUtf8("0B6666A0-BB59-1381-B746-a0E4C9AC"),
        bytes.slice(0, 16).buffer
      ));
    } catch (error) {
      throw new Error("漫蛙图片解密失败，请检查 Venera 版本或更新此配置。");
    }

    // Venera 的 Convert.decryptAesCbc 不会自动移除填充。
    // 必须校验全部填充字节，不能只按最后一个字节盲目裁剪。
    const padding = decrypted[decrypted.length - 1];
    if (!(padding >= 1 && padding <= 16 && padding <= decrypted.length)) {
      throw new Error("漫蛙图片解密校验失败，数据可能损坏或网站已更换加密方式。");
    }
    for (let i = decrypted.length - padding; i < decrypted.length; i++) {
      if (decrypted[i] !== padding) {
        throw new Error("漫蛙图片解密校验失败，数据可能损坏或网站已更换加密方式。");
      }
    }
    const image = decrypted.slice(0, decrypted.length - padding);
    if (!this.isImageData(image)) {
      throw new Error("漫蛙图片解密后格式无效，网站可能已更换加密方式，请更新此配置。");
    }
    return image.buffer;
  }

  imageLoadingConfig(url) {
    const requestUrl = url.startsWith("//") ? "https:" + url : url;
    return {
      url: requestUrl,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      // 保持同步，兼容 Venera 的正文及封面图片回调。
      onResponse: (buffer) => this.decodeImageResponse(buffer),
    };
  }

  // dart:io 对 POST 的 301/302 不自动改为 GET，交由此处保留请求体跟随。
  // 此客户端选项已由 Venera 1.4.0 支持，仅用于分类请求。
  async fetchCategoryJson(url, payload) {
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      http_client: "dart:io",
    };
    for (let redirects = 0; redirects <= 5; redirects++) {
      const res = await Network.sendRequest("POST", url, headers, payload);
      if ([301, 302, 307, 308].includes(res.status)) {
        const responseHeaders = res.headers || {};
        const locationKey = Object.keys(responseHeaders).find(
          (key) => key.toLowerCase() === "location"
        );
        const location = locationKey && responseHeaders[locationKey];
        if (!location || redirects === 5) {
          throw new Error("漫蛙分类域名跳转失败，请更新配置。HTTP " + res.status);
        }
        url = this.resolveCategoryRedirect(url, String(location));
        continue;
      }
      if (res.status !== 200) {
        throw new Error(
          "漫蛙分类请求失败：HTTP " + res.status + "，POST " + url +
          "，body: " + String(res.body || "").slice(0, 200)
        );
      }
      return JSON.parse(res.body);
    }
  }

  resolveCategoryRedirect(currentUrl, location) {
    location = location.trim();
    let target;
    if (/^https:\/\//i.test(location)) {
      target = location;
    } else if (location.startsWith("//")) {
      target = "https:" + location;
    } else {
      // 不依赖 Venera JS 环境未提供的浏览器 URL 类。
      const base = /^(https:\/\/[^/?#]+)([^?#]*)/i.exec(currentUrl);
      if (!base || /^[a-z][a-z0-9+.-]*:/i.test(location)) {
        throw new Error("漫蛙分类返回了无效的跳转地址。");
      }
      if (location.startsWith("/")) {
        target = base[1] + location;
      } else if (location.startsWith("?")) {
        target = base[1] + base[2] + location;
      } else {
        const directory = base[2].slice(0, base[2].lastIndexOf("/") + 1);
        target = base[1] + directory + location;
      }
    }
    const parts = /^(https:\/\/[^/?#]+)([^?#]*)(\?[^#]*)?(?:#.*)?$/i.exec(target);
    if (!parts || /[\s\\@]/.test(parts[1])) {
      throw new Error("漫蛙分类返回了无效的跳转地址。");
    }
    const path = [];
    for (const segment of parts[2].split("/")) {
      if (segment === "..") path.pop();
      else if (segment !== ".") path.push(segment);
    }
    return parts[1] + path.join("/") + (parts[3] || "");
  }

  cleanSearchKeyword(value) {
    let text = String(value == null ? "" : value);
    if (typeof text.normalize === "function") text = text.normalize("NFKC");
    return text.replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
  }

  searchTitleKey(value) {
    return this.cleanSearchKeyword(value).toLowerCase()
      .replace(/[\s《》〈〉「」『』【】\[\]()（）:：,，.。!！?？·•・_\-—–'"“”‘’]/g, "");
  }

  searchBaseTitle(value) {
    return this.cleanSearchKeyword(value)
      .replace(/\s*[（(【\[]\s*(?:完整版|完结版|完結版|台版|臺版|无删减版?|無刪減版?|全彩版|全集)\s*[）)】\]]\s*$/i, "")
      .replace(/\s+(?:完整版|完结版|完結版|台版|臺版|无删减版?|無刪減版?|全彩版|全集)\s*$/i, "").trim();
  }

  searchQueries(keyword) {
    const original = this.cleanSearchKeyword(keyword);
    if (!original) return [];
    const unquoted = original.replace(/[《》〈〉「」『』]/g, "").trim();
    const base = this.searchBaseTitle(unquoted);
    // 仅在前一个关键词没有结果时尝试下一个；保留正常的外文单词间空格。
    const compact = /[\u3400-\u9fff]/.test(base) ? base.replace(/\s+/g, "") : base;
    return [...new Set([original, unquoted, base, compact].filter(Boolean))];
  }

  async fetchSearchPage(keyword, page, preferredApi, pageSize = 50) {
    const endpoints = [...new Set([preferredApi, this.categoryApi, this.api].filter(Boolean))];
    let lastError;
    for (const api of endpoints) {
      for (const size of pageSize > 20 ? [pageSize, 20] : [pageSize]) {
        try {
          const origin = api.replace(/\/api\/?$/, "");
          const json = await this.fetchJson(api + "/search", {
            params: { keyword, type: "mh", page, pageSize: size },
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
              Referer: origin + "/search",
            },
          });
          const data = json && json.data;
          if (!data || !Array.isArray(data.list)) {
            throw new Error("漫蛙搜索返回的数据格式异常，请更新配置。");
          }
          const pagination = data.pagination || json.pagination || {};
          const rawTotal = data.total != null ? data.total : pagination.total;
          let total = rawTotal != null && Number.isFinite(Number(rawTotal)) && Number(rawTotal) >= 0
            ? Number(rawTotal) : null;
          if (total === 0 && data.list.length) total = null;
          const reportedSize = Number(pagination.pageSize || pagination.page_size || data.pageSize || data.page_size);
          return { api, list: data.list, total, requestedSize: size,
            pageSize: Number.isInteger(reportedSize) && reportedSize > 0 && reportedSize <= 500 ? reportedSize : null };
        } catch (error) {
          lastError = error;
          // 若站点拒绝较大的分页参数，使用原配置的 20 条重试。
          if (size > 20 && /Invalid status code: (?:400|413|422)\b/.test(String(error))) continue;
          break;
        }
      }
    }
    throw new Error("漫蛙搜索请求失败，请检查网络或稍后重试。" + String(lastError || "").slice(0, 180));
  }

  parseSearchResults(items, keyword) {
    const exact = this.searchTitleKey(keyword);
    const base = this.searchTitleKey(this.searchBaseTitle(
      this.cleanSearchKeyword(keyword).replace(/[《》〈〉「」『』]/g, "")
    ));
    const seen = new Set();
    const comics = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const rawId = item.id != null ? item.id : item.comicId != null ? item.comicId : item.comic_id;
      const urlId = typeof item.url === "string" && item.url.match(/\/comic\/([^/?#]+)/);
      const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : urlId ? urlId[1] : "";
      const titleValue = item.title || item.name || "";
      const title = typeof titleValue === "string" ? titleValue.trim() : "";
      if (!id || !title || seen.has(id)) continue;
      seen.add(id);
      const tags = Array.isArray(item.tags) ? item.tags : String(item.tags || "").split(/[,，]/);
      const comic = new Comic({
        id, title,
        subTitle: item.author || "",
        cover: item.cover || item.pic || "",
        tags: tags.map((tag) => String(typeof tag === "object" && tag ? tag.name || tag.label || "" : tag == null ? "" : tag).trim()).filter(Boolean),
        description: item.description || item.intro || "",
        status: item.status == 0 ? "连载中" : item.status == 1 ? "已完结" : undefined,
      });
      const key = this.searchTitleKey(title);
      const titleBase = this.searchTitleKey(this.searchBaseTitle(title));
      const score = key === exact ? 0 : titleBase === base ? 1
        : base && key.startsWith(base) ? 2 : base && key.includes(base) ? 3 : 4;
      comics.push({ comic, score, index: comics.length });
    }
    if (items.length && !comics.length) {
      throw new Error("漫蛙搜索结果缺少漫画编号或名称，请更新配置。");
    }
    comics.sort((a, b) => a.score - b.score || a.index - b.index);
    return comics.map((item) => item.comic);
  }

  async searchComics(keyword, page) {
    const queries = this.searchQueries(keyword);
    if (!queries.length) return { comics: [], maxPage: 1 };
    page = Math.max(1, Math.floor(Number(page) || 1));
    if (!this._searchSessions) this._searchSessions = new Map();
    const key = queries[0];
    let session = this._searchSessions.get(key);
    if (session && session.expires <= Date.now()) {
      this._searchSessions.delete(key);
      session = null;
    }
    if (!session) {
      let first;
      let selected = queries[0];
      for (const query of queries) {
        first = await this.fetchSearchPage(query, 1);
        selected = query;
        if (first.list.length) break;
      }
      // 部分站点限制最多 20 条，不能按请求的 50 条直接计算页数。
      const pageSize = first.pageSize || (first.list.length && (first.total == null || first.total > first.list.length)
        ? Math.min(first.requestedSize, first.list.length) : first.requestedSize);
      session = { query: selected, api: first.api, pageSize,
        expires: Date.now() + (first.list.length ? 5 * 60 * 1000 : 30 * 1000), pages: new Map([[1, first]]) };
      this._searchSessions.set(key, session);
      while (this._searchSessions.size > 6) this._searchSessions.delete(this._searchSessions.keys().next().value);
    }
    let data = session.pages.get(page);
    if (!data) {
      data = await this.fetchSearchPage(session.query, page, session.api, session.pageSize);
      session.api = data.api;
      session.pages.set(page, data);
      while (session.pages.size > 5) session.pages.delete(session.pages.keys().next().value);
    }
    const maxPage = data.total != null
      ? Math.max(1, page, Math.ceil(data.total / session.pageSize))
      : data.list.length >= session.pageSize ? page + 1 : page;
    return { comics: this.parseSearchResults(data.list, key), maxPage };
  }


  init() {
    /**
     * Sends an HTTP request.
     * @param {string} url - The URL to send the request to.
     * @param {string} method - The HTTP method (e.g., GET, POST, PUT, PATCH, DELETE).
     * @param {Object} params - The query parameters to include in the request.
     * @param {Object} headers - The headers to include in the request.
     * @param {string} payload - The payload to include in the request.
     * @returns {Promise<Object>} The response from the request.
     */
    this.fetchJson = async (
      url,
      { method = "GET", params, headers, payload } = {}
    ) => {
      if (params) {
        let params_str = Object.keys(params)
          .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
          .join("&");
        url += `${url.includes("?") ? "&" : "?"}${params_str}`;
      }
      headers = { Accept: "application/json", ...(headers || {}) };
      if (payload !== undefined && !headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
      let res = await Network.sendRequest(method, url, headers, payload);
      if (res.status !== 200) {
        throw `Invalid status code: ${res.status}, body: ${res.body}`;
      }
      let json = JSON.parse(res.body);
      return json;
    };
    this.logger = {
      error: (msg) => {
        log("error", this.name, msg);
      },
      info: (msg) => {
        log("info", this.name, msg);
      },
      warn: (msg) => {
        log("warning", this.name, msg);
      },
    };
  }

  // explore page list
  explore = [
    {
      // title of the page.
      // title is used to identify the page, it should be unique
      title: this.name,

      /// multiPartPage or multiPageComicList or mixed
      type: "singlePageWithMultiPart",

      /**
       * load function
       * @param page {number | null} - page number, null for `singlePageWithMultiPart` type
       * @returns {{}}
       * - for `multiPartPage` type, return [{title: string, comics: Comic[], viewMore: PageJumpTarget}]
       * - for `multiPageComicList` type, for each page(1-based), return {comics: Comic[], maxPage: number}
       * - for `mixed` type, use param `page` as index. for each index(0-based), return {data: [], maxPage: number?}, data is an array contains Comic[] or {title: string, comics: Comic[], viewMore: string?}
       */
      load: async (page) => {
        let params = {
          page: 1,
          pageSize: 6,
          type: "",
          flag: false,
        };
        const url = `${this.api}/home`;
        const data = await this.fetchJson(url, { params }).then(
          (res) => res.data
        );
        let magnaList = {
          热门: data.comicList,
          最新完整版: data.gufengList,
          最新更新: data.xuanhuanList,
          热门收藏: data.xiaoyuanList,
        };
        function parseComic(comic) {
          return new Comic({
            id: comic.id.toString(),
            title: comic.title,
            subTitle: comic.author,
            cover: comic.pic,
            tags: comic.tags.split(","),
          });
        }
        let result = {};
        for (let key in magnaList) {
          result[key] = magnaList[key].map(parseComic);
        }
        return result;
      },
    },
  ];

  // categories
  category = {
    /// title of the category page, used to identify the page, it should be unique
    title: this.name,
    parts: [
      {
        // title of the part
        name: "类型",

        // fixed or random or dynamic
        // if random, need to provide `randomNumber` field, which indicates the number of comics to display at the same time
        // if dynamic, need to provide `loader` field, which indicates the function to load comics
        type: "fixed",

        // Remove this if type is dynamic
        categories: [
          "全部",
          "热血",
          "玄幻",
          "恋爱",
          "冒险",
          "古风",
          "都市",
          "穿越",
          "奇幻",
          "其他",
          "搞笑",
          "少男",
          "战斗",
          "重生",
          "逆袭",
          "爆笑",
          "少年",
          "后宫",
          "系统",
          "BL",
          "韩漫",
          "完整版",
          "19r",
          "台版",
        ],

        itemType: "category",
        categoryParams: [
          "",
          "热血",
          "玄幻",
          "恋爱",
          "冒险",
          "古风",
          "都市",
          "穿越",
          "奇幻",
          "其他",
          "搞笑",
          "少男",
          "战斗",
          "重生",
          "逆袭",
          "爆笑",
          "少年",
          "后宫",
          "系统",
          "BL",
          "韩漫",
          "完整版",
          "19r",
          "台版",
        ],
      },
    ],
    // enable ranking page
    enableRankingPage: false,
  };

  /// category comic loading related
  categoryComics = {
    /**
     * load comics of a category
     * @param category {string} - category name
     * @param param {string?} - category param
     * @param options {string[]} - options from optionList
     * @param page {number} - page number
     * @returns {Promise<{comics: Comic[], maxPage: number}>}
     */
    load: async (category, param, options, page) => {
      let pathMap = {
        "": "/cate",
        "热血": "/cate/hotblooded",
        "玄幻": "/cate/xuanhuan",
        "恋爱": "/cate/romance",
        "冒险": "/cate/adventure",
        "古风": "/cate/historical",
        "都市": "/cate/urban",
        "穿越": "/cate/transmigration",
        "奇幻": "/cate/fantasy",
        "搞笑": "/cate/comedy",
        "少男": "/cate/shounen",
        "战斗": "/cate/action",
        "重生": "/cate/rebirth",
        "逆袭": "/cate/counterattack",
        "爆笑": "/cate/hilarious",
        "少年": "/cate/youth",
        "系统": "/cate/system",
        "BL": "/cate/bl",
        "韩漫": "/cate/manhwa",
        "完整版": "/cate/fullversion",
        "19r": "/cate/19plus",
        "台版": "/cate/taiwanver",
      };
      let url = this.categoryApi + (pathMap[param] || "/cate");
      let payload = JSON.stringify({
        page: {
          page: page,
          pageSize: 10,
        },
        category: "comic",
        sort: parseInt(options[2]),
        comic: {
          status: parseInt(options[0] == "2" ? -1 : options[0]),
          day: parseInt(options[1]),
          tag: param,
        },
        video: {
          year: 0,
          typeId: 0,
          typeId1: 0,
          area: "",
          lang: "",
          status: -1,
          day: 0,
        },
        novel: {
          status: -1,
          day: 0,
          sortId: 0,
        },
      });

      let data = await this.fetchCategoryJson(url, payload)
        .then((res) => res.data.list);

      function parseComic(comic) {
        return new Comic({
          id: comic.url.split("/").pop(),
          title: comic.title,
          subTitle: comic.author,
          cover: comic.pic,
          tags: comic.tags.split(","),
          description: comic.intro,
          status: comic.status == 0 ? "连载中" : "已完结",
        });
      }
      return {
        comics: data.map(parseComic),
        maxPage: 100,
      };
    },
    // provide options for category comic loading
    optionList: [
      {
        options: ["2-全部", "0-连载中", "1-已完结"],
      },
      {
        options: [
          "0-全部",
          "1-周一",
          "2-周二",
          "3-周三",
          "4-周四",
          "5-周五",
          "6-周六",
          "7-周日",
        ],
      },
      {
        options: ["0-更新", "1-新作", "2-畅销", "3-热门", "4-收藏"],
      },
    ],
  };

  /// search related
  search = {
    /**
     * load search result
     * @param keyword {string}
     * @param options {string[]} - options from optionList
     * @param page {number}
     * @returns {Promise<{comics: Comic[], maxPage: number}>}
     */
    load: async (keyword, options, page) => {
      return this.searchComics(keyword, page);
    },
  };

  /// single comic related
  comic = {
    /**
     * load comic info
     * @param id {string}
     * @returns {Promise<ComicDetails>}s
     */
    loadInfo: async (id) => {
      let url = `${this.api}/comic/${id}`;
      let data = await this.fetchJson(url, { payload: undefined }).then(
        (res) => res.data
      );
      let chapterId = data.id;
      let chapterApi = `${this.api}/comic/chapter`;
      let params = {
        comicId: chapterId,
        page: 1,
        pageSize: 1,
      };
      let pageRes = await this.fetchJson(chapterApi, { params });
      let total = pageRes.pagination.total;

      let chapterRes = await this.fetchJson(chapterApi, {
        params: {
          ...params,
          pageSize: total,
        },
      });
      let chapterList = chapterRes.data;
      let chapters = new Map();
      chapterList.forEach((item) => {
        chapters.set(item.id.toString(), item.title.toString());
      });

      return new ComicDetails({
        title: data.title.toString(),
        subTitle: data.author.toString(),
        cover: data.cover,
        tags: {
          类型: data.tags.split(","),
          状态: data.status == 0 ? "连载中" : "已完结",
        },
        chapters,
        description: data.intro,
        updateTime: new Date(data.editTime * 1000).toLocaleDateString(),
      });
    },
    /**
     * load images of a chapter
     * @param comicId {string}
     * @param epId {string?}
     * @returns {Promise<{images: string[]}>}
     */
    loadEp: async (comicId, epId) => {
      let imgApi = `${this.api}/comic/image/${epId}`;
      let params = {
        page: 1,
        pageSize: 1,
        imageSource: "https://tu.mhttu.cc",
      };
      let pageNum = await this.fetchJson(imgApi, {
        params,
      }).then((res) => res.data.pagination.total);
      let imageRes = await this.fetchJson(imgApi, {
        params: {
          ...params,
          page_size: pageNum,
        },
      }).then((res) => res.data.images);
      let images = imageRes.map((item) => item.url);
      return {
        images,
      };
    },
    onImageLoad: (url, comicId, epId) => this.imageLoadingConfig(url),
    onThumbnailLoad: (url) => this.imageLoadingConfig(url),
  };
}
