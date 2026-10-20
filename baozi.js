class Baozi extends ComicSource {
  // 此漫画源的名称
  name = "包子漫画";

  // 唯一标识符
  key = "baozi";

  version = "1.1.7";

  minAppVersion = "1.5.0";

  // 更新链接
  url = "https://raw.githubusercontent.com/YongkeDet/venera-configs/main/baozi.js";

  settings = {
    language: {
      title: "简繁切换",
      type: "select",
      options: [
        { value: "cn", text: "简体" },
        { value: "tw", text: "繁體" },
      ],
      default: "cn",
    },
    domains: {
      title: "主域名",
      type: "select",
      options: [
        { value: "bzmgcn.com" },
        { value: "baozimhcn.com" },
        { value: "webmota.com" },
        { value: "kukuc.co" },
        { value: "twmanga.com" },
        { value: "dinnerku.com" },
      ],
      default: "bzmgcn.com",
    },
    cdn_domains: {
      title: "图片资源站域名",
      type: "select",
      options: [
        { value: "as-rsa1-usla.baozicdn.com" },
        { value: "ascn-a3.bzcdn.net" },
        { value: "asgb-a3.bzcdn.net" },
        { value: "as.baozimh.com" },
        { value: "s1.baozicdn.com" },
        { value: "", text: "默认" },
      ],
      default: "",
    },
    image_quality: {
      title: "图片质量",
      type: "select",
      options: [
        {
          value: "/w640",
          text: "640p"
        },
        {
          value: "",
          text: "原图"
        }
      ],
      default: "/w640",
    },
  };

  // 动态生成完整域名
  get lang() {
    return this.loadSetting("language") || this.settings.language.default;
  }
  get baseUrl() {
    let domain = this.loadSetting("domains") || this.settings.domains.default;
    return `https://${this.lang}.${domain}`;
  }

  /// 账号
  /// 设置为null禁用账号功能
  account = {
    /// 登录
    /// 返回任意值表示登录成功
    login: async (account, pwd) => {
      let res = await Network.post(
        `${this.baseUrl}/api/bui/signin`,
        {
          "content-type":
            "multipart/form-data; boundary=----WebKitFormBoundaryFUNUxpOwyUaDop8s",
        },
        '------WebKitFormBoundaryFUNUxpOwyUaDop8s\r\nContent-Disposition: form-data; name="username"\r\n\r\n' +
        account +
        '\r\n------WebKitFormBoundaryFUNUxpOwyUaDop8s\r\nContent-Disposition: form-data; name="password"\r\n\r\n' +
        pwd +
        "\r\n------WebKitFormBoundaryFUNUxpOwyUaDop8s--\r\n"
      );
      if (res.status !== 200) {
        throw "Invalid status code: " + res.status;
      }
      let json = JSON.parse(res.body);
      let token = json.data;
      Network.setCookies(this.baseUrl, [
        new Cookie({
          name: "TSID",
          value: token,
          domain: this.loadSetting("domains") || this.settings.domains.default,
        }),
      ]);
      return "ok";
    },

    // 退出登录时将会调用此函数
    logout: function () {
      Network.deleteCookies(
        this.loadSetting("domains") || this.settings.domains.default
      );
    },

    get registerWebsite() {
      return `${this.baseUrl}/user/signup`;
    },
  };

  // 分类站点当前使用此规范域名；language 参数仍跟随简繁设置。
  categoryOrigin = "https://www.baozimh.com";

  categoryHeaders() {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept: "application/json",
      Referer: this.categoryOrigin + "/classify",
      Origin: this.categoryOrigin,
    };
  }

  async fetchCategory(url) {
    const headers = this.categoryHeaders();
    let response = await Network.get(url, headers);
    if (response.status === 403) {
      let challenge;
      try { challenge = JSON.parse(response.body); } catch (_) {}
      const challengeHtml = typeof response.body === "string" &&
        response.body.includes("gatekeeperChallenge") ? response.body : null;
      if ((challenge && challenge.error === "challenge_required") || challengeHtml) {
        const path = challenge && challenge.challenge_url;
        if (!challengeHtml && (typeof path !== "string" || !path.startsWith("/__gatekeeper_challenge/start?"))) {
          throw new Error("包子分类验证入口已变化，请更新配置。");
        }
        // 多个分类同时加载时共享一次验证，Cookie 由 Venera 网络层保存。
        if (!this._categoryVerification) {
          this._categoryVerification = this.verifyCategoryChallenge(path, challengeHtml)
            .finally(() => { this._categoryVerification = null; });
        }
        await this._categoryVerification;
        response = await Network.get(url, headers);
      }
    }
    if (response.status !== 200) {
      throw new Error("包子分类请求失败：HTTP " + response.status + "，请稍后重试或检查网络。");
    }
    const json = JSON.parse(response.body);
    if (!Array.isArray(json.items)) {
      throw new Error("包子分类返回的数据格式已变化，请更新配置。");
    }
    return json;
  }

  async verifyCategoryChallenge(path, challengeHtml) {
    const headers = this.categoryHeaders();
    let html = challengeHtml;
    if (!html) {
      const response = await Network.get(this.categoryOrigin + path, headers);
      if (response.status !== 200) {
        throw new Error("包子分类验证暂不可用：HTTP " + response.status);
      }
      html = response.body;
    }
    // 只提取网站协议中的数据，不执行网页返回的 JavaScript。
    const read = (name, pattern) => {
      const match = html.match(new RegExp(name + "\\s*:\\s*" + pattern));
      if (!match) throw new Error("包子分类验证方式已变化，请更新配置。");
      return match[1];
    };
    const challengeId = read("challengeId", '"([a-f0-9]{64})"');
    const ticket = read("ticket", '"([A-Za-z0-9_.-]{20,4096})"');
    const verifyUrl = read("verifyUrl", '"(/__gatekeeper_challenge/verify)"');
    const bits = Number(read("difficultyBits", "([0-9]+)"));
    if (!Number.isInteger(bits) || bits < 1 || bits > 20) {
      throw new Error("包子分类验证计算量超出支持范围，请稍后重试。");
    }
    // 与网站 worker.js 相同：SHA-256("gatekeeper-pow-v1:" + id + ":" + nonce)。
    // 在 Venera 后台引擎计算，最多 15 秒，避免阻塞界面或无限重试。
    const nonce = await compute("(" + this.categoryPowSolver.toString() + ")", {
      challengeId, bits, maxMs: 15000,
    });
    // 提交前以 Venera 的原生 SHA-256 再校验一次。
    const digest = new Uint8Array(Convert.sha256(Convert.encodeUtf8(
      "gatekeeper-pow-v1:" + challengeId + ":" + nonce
    )));
    for (let i = 0; i < bits; i++) {
      if ((digest[i >> 3] & (128 >> (i & 7))) !== 0) {
        throw new Error("包子分类验证计算失败，请重试。");
      }
    }
    const verified = await Network.post(this.categoryOrigin + verifyUrl, {
      ...headers, "Content-Type": "application/json",
    }, JSON.stringify({ challenge_id: challengeId, ticket, nonce }));
    let result;
    try { result = JSON.parse(verified.body); } catch (_) {}
    if (verified.status !== 200 || !result || result.status !== "passed") {
      throw new Error("包子分类验证未通过：HTTP " + verified.status + "，请重试并保持网络出口不变。");
    }
  }

  // 自包含的 SHA-256 工作量计算函数，供 compute 后台引擎运行。
  categoryPowSolver = function (config) {
    if (!/^[a-f0-9]{64}$/.test(config.challengeId) ||
        !Number.isInteger(config.bits) || config.bits < 1 || config.bits > 20) {
      throw new Error("无效的包子分类验证参数。");
    }
    const k = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ];
    const initial = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const words = new Int32Array(64);
    const rotate = (x, n) => (x >>> n) | (x << (32 - n));
    const compress = (block, state) => {
      for (let i = 0; i < 16; i++) words[i] = block[i];
      for (let i = 16; i < 64; i++) {
        const x = words[i - 15], y = words[i - 2];
        const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
        const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
        words[i] = (words[i - 16] + s0 + words[i - 7] + s1) | 0;
      }
      let [a,b,c,d,e,f,g,h] = state;
      for (let i = 0; i < 64; i++) {
        const s1 = rotate(e,6) ^ rotate(e,11) ^ rotate(e,25);
        const t1 = (h + s1 + ((e & f) ^ (~e & g)) + k[i] + words[i]) | 0;
        const s0 = rotate(a,2) ^ rotate(a,13) ^ rotate(a,22);
        const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
      }
      return [(state[0]+a)|0,(state[1]+b)|0,(state[2]+c)|0,(state[3]+d)|0,
              (state[4]+e)|0,(state[5]+f)|0,(state[6]+g)|0,(state[7]+h)|0];
    };
    const prefix = "gatekeeper-pow-v1:" + config.challengeId + ":";
    const block = new Int32Array(16);
    for (let i = 0; i < 64; i++) block[i >> 2] |= prefix.charCodeAt(i) << (24 - (i & 3) * 8);
    const first = compress(block, initial);
    const tail = prefix.slice(64);
    const deadline = Date.now() + Math.min(Math.max(Number(config.maxMs) || 15000, 1), 15000);
    for (let nonce = 0; nonce < 10000000; nonce++) {
      if ((nonce & 1023) === 0 && Date.now() >= deadline) {
        throw new Error("包子分类验证计算超时，请重试。");
      }
      block.fill(0);
      const text = tail + nonce;
      for (let i = 0; i < text.length; i++) block[i >> 2] |= text.charCodeAt(i) << (24 - (i & 3) * 8);
      block[text.length >> 2] |= 0x80 << (24 - (text.length & 3) * 8);
      block[15] = (64 + text.length) * 8;
      const hash = compress(block, first);
      if ((hash[0] >>> (32 - config.bits)) === 0) return String(nonce);
    }
    throw new Error("包子分类验证未完成，请重试。");
  };


  /// 解析漫画列表
  parseComic(e) {
    let url = e.querySelector("a").attributes["href"];
    let id = url.split("/").pop();
    let title = e.querySelector("h3").text.trim();
    let cover = e.querySelector("a > amp-img").attributes["src"];
    let tags = e.querySelectorAll("div.tabs > span").map((e) => e.text.trim());
    let description = e.querySelector("small").text.trim();
    return {
      id: id,
      title: title,
      cover: cover,
      tags: tags,
      description: description,
    };
  }

  parseJsonComic(e) {
    return {
      id: e.comic_id,
      title: e.name,
      subTitle: e.author,
      cover: `https://static-tw.baozimh.com/cover/${e.topic_img}?w=285&h=375&q=100`,
      tags: e.type_names,
    };
  }

  /// 探索页面
  /// 一个漫画源可以有多个探索页面
  explore = [
    {
      /// 标题
      /// 标题同时用作标识符, 不能重复
      title: "包子漫画",

      /// singlePageWithMultiPart 或者 multiPageComicList
      type: "singlePageWithMultiPart",

      load: async () => {
        var res = await Network.get(this.baseUrl);
        if (res.status !== 200) {
          throw "Invalid status code: " + res.status;
        }
        let document = new HtmlDocument(res.body);
        let parts = document.querySelectorAll("div.index-recommend-items");
        let result = {};
        for (let part of parts) {
          let title = part.querySelector("div.catalog-title").text.trim();
          let comics = part
            .querySelectorAll("div.comics-card")
            .map((e) => this.parseComic(e));
          if (comics.length > 0) {
            result[title] = comics;
          }
        }
        return result;
      },
    },
  ];

  /// 分类页面
  /// 一个漫画源只能有一个分类页面, 也可以没有, 设置为null禁用分类页面
  category = {
    /// 标题, 同时为标识符, 不能与其他漫画源的分类页面重复
    title: "包子漫画",
    parts: [
      {
        name: "类型",

        // fixed 或者 random
        // random用于分类数量相当多时, 随机显示其中一部分
        type: "fixed",

        // 如果类型为random, 需要提供此字段, 表示同时显示的数量
        // randomNumber: 5,

        categories: [
          "全部",
          "恋爱",
          "纯爱",
          "古风",
          "异能",
          "悬疑",
          "剧情",
          "科幻",
          "奇幻",
          "玄幻",
          "穿越",
          "冒险",
          "推理",
          "武侠",
          "格斗",
          "战争",
          "热血",
          "搞笑",
          "大女主",
          "都市",
          "总裁",
          "后宫",
          "日常",
          "韩漫",
          "少年",
          "其它",
        ],

        // category或者search
        // 如果为category, 点击后将进入分类漫画页面, 使用下方的`categoryComics`加载漫画
        // 如果为search, 将进入搜索页面
        itemType: "category",

        // 若提供, 数量需要和`categories`一致, `categoryComics.load`方法将会收到此参数
        categoryParams: [
          "all",
          "lianai",
          "chunai",
          "gufeng",
          "yineng",
          "xuanyi",
          "juqing",
          "kehuan",
          "qihuan",
          "xuanhuan",
          "chuanyue",
          "mouxian",
          "tuili",
          "wuxia",
          "gedou",
          "zhanzheng",
          "rexie",
          "gaoxiao",
          "danuzhu",
          "dushi",
          "zongcai",
          "hougong",
          "richang",
          "hanman",
          "shaonian",
          "qita",
        ],
      },
    ],
    enableRankingPage: false,
  };

  /// 分类漫画页面, 即点击分类标签后进入的页面
  categoryComics = {
    load: async (category, param, options, page) => {
      const params = {
        type: param || "all",
        region: options[0] || "all",
        state: options[1] || "all",
        filter: "*",
        page,
        limit: 36,
        language: this.lang,
        __amp_source_origin: this.categoryOrigin,
      };
      const query = Object.keys(params).map((key) =>
        encodeURIComponent(key) + "=" + encodeURIComponent(params[key])
      ).join("&");
      const json = await this.fetchCategory(
        this.categoryOrigin + "/api/bzmhq/amp_comic_list?" + query
      );
      let maxPage = null;
      if (!json.next) {
        maxPage = page;
      }
      return {
        comics: json.items.map((e) => this.parseJsonComic(e)),
        maxPage: maxPage,
      };
    },
    // 提供选项
    optionList: [
      {
        options: ["all-全部", "cn-国漫", "jp-日本", "kr-韩国", "en-欧美"],
      },
      {
        options: ["all-全部", "serial-连载中", "pub-已完结"],
      },
    ],
  };

  /// 搜索
  search = {
    load: async (keyword, options, page) => {
      let res = await Network.get(`${this.baseUrl}/search?q=${keyword}`);
      if (res.status !== 200) {
        throw "Invalid status code: " + res.status;
      }
      let document = new HtmlDocument(res.body);
      let comics = document
        .querySelectorAll("div.comics-card")
        .map((e) => this.parseComic(e));
      return {
        comics: comics,
        maxPage: 1,
      };
    },

    // 提供选项
    optionList: [],
  };

  /// 收藏
  favorites = {
    /// 是否为多收藏夹
    multiFolder: false,
    /// 添加或者删除收藏
    addOrDelFavorite: async (comicId, folderId, isAdding) => {
      if (!isAdding) {
        let res = await Network.post(
          `${this.baseUrl}/user/operation_v2?op=del_bookmark&comic_id=${comicId}`
        );
        if (!res.status || res.status >= 400) {
          throw "Invalid status code: " + res.status;
        }
        return "ok";
      } else {
        let res = await Network.post(
          `${this.baseUrl}/user/operation_v2?op=set_bookmark&comic_id=${comicId}&chapter_slot=0`
        );
        if (!res.status || res.status >= 400) {
          throw "Invalid status code: " + res.status;
        }
        return "ok";
      }
    },
    // 加载收藏夹, 仅当multiFolder为true时有效
    // 当comicId不为null时, 需要同时返回包含该漫画的收藏夹
    loadFolders: null,
    /// 加载漫画
    loadComics: async (page, folder) => {
      let res = await Network.get(`${this.baseUrl}/user/my_bookshelf`);
      if (res.status !== 200) {
        throw "Invalid status code: " + res.status;
      }
      let document = new HtmlDocument(res.body);
      function parseComic(e) {
        let title = e.querySelector("h4 > a").text.trim();
        let url = e.querySelector("h4 > a").attributes["href"];
        let id = url.split("/").pop();
        let author = e
          .querySelector("div.info > ul")
          .children[1].text.split("：")[1]
          .trim();
        let description = e
          .querySelector("div.info > ul")
          .children[4].children[0].text.trim();

        return {
          id: id,
          title: title,
          subTitle: author,
          description: description,
          cover: e.querySelector("amp-img").attributes["src"],
        };
      }
      let comics = document
        .querySelectorAll("div.bookshelf-items")
        .map((e) => parseComic(e));
      return {
        comics: comics,
        maxPage: 1,
      };
    },
  };

  /// 单个漫画相关
  comic = {
    // 加载漫画信息
    loadInfo: async (id) => {
      let res = await Network.get(`${this.baseUrl}/comic/${id}`);
      if (res.status !== 200) {
        throw "Invalid status code: " + res.status;
      }
      let document = new HtmlDocument(res.body);

      let title = document.querySelector("h1.comics-detail__title").text.trim();
      let cover = document.querySelector("div.l-content > div > div > amp-img")
        .attributes["src"];
      let author = document
        .querySelector("h2.comics-detail__author")
        .text.trim();
      let tags = document
        .querySelectorAll("div.tag-list > span")
        .map((e) => e.text.trim());
      tags = [...tags.filter((e) => e !== "")];
      let updateTime = document
        .querySelector("div.supporting-text > div > span > em")
        ?.text.trim()
        .replace("(", "")
        .replace(")", "");
      if (!updateTime) {
        const getLastChapterText = () => {
          // 合并所有章节容器（处理可能存在多个列表的情况）
          const containers = [
            ...document.querySelectorAll(
              "#chapter-items, #chapters_other_list"
            ),
          ];
          let allChapters = [];
          containers.forEach((container) => {
            const chapters = container.querySelectorAll(".comics-chapters > a");
            allChapters.push(...Array.from(chapters));
          });
          const lastChapter = allChapters[allChapters.length - 1];
          return (
            lastChapter?.querySelector("div > span")?.text.trim() ||
            "暂无更新信息"
          );
        };
        updateTime = getLastChapterText();
      }
      let description = document
        .querySelector("p.comics-detail__desc")
        .text.trim();
      let chapters = new Map();
      let i = 0;
      for (let c of document.querySelectorAll(
        "div#chapter-items > div.comics-chapters > a > div > span"
      )) {
        chapters.set(i.toString(), c.text.trim());
        i++;
      }
      for (let c of document.querySelectorAll(
        "div#chapters_other_list > div.comics-chapters > a > div > span"
      )) {
        chapters.set(i.toString(), c.text.trim());
        i++;
      }
      if (i === 0) {
        // 将倒序的最新章节反转
        const spans = Array.from(
          document.querySelectorAll("div.comics-chapters > a > div > span")
        ).reverse();
        for (let c of spans) {
          chapters.set(i.toString(), c.text.trim());
          i++;
        }
      }
      let recommend = [];
      for (let c of document.querySelectorAll("div.recommend--item")) {
        if (c.querySelectorAll("div.tag-comic").length > 0) {
          let title = c.querySelector("span").text.trim();
          let cover = c.querySelector("amp-img").attributes["src"];
          let url = c.querySelector("a").attributes["href"];
          let id = url.split("/").pop();
          recommend.push({
            id: id,
            title: title,
            cover: cover,
          });
        }
      }
      // updateTime 将 Y年 M月 D日 转化为 Y-M-D
      let updateDate = updateTime
        .replace(/年/g, "-")
        .replace(/月/g, "-")
        .replace(/日/g, "");

      return new ComicDetails({
        title: title,
        cover: cover,
        description: description,
        tags: {
          作者: [author],
          标签: tags,
        },
        chapters: chapters,
        recommend: recommend,
        updateTime: updateDate,
      });
    },
    loadEp: async (comicId, epId) => {
      const images = [];

      // App版链接
      let currentPageUrl = `https://appcn.baozimh.com/baozimhapp/comic/chapter/${comicId}/0_${epId}.html`;

      const res = await Network.get(currentPageUrl);
      if (res.status !== 200) {
        throw `Invalid status code: ${res.status}`;
      }

      const doc = new HtmlDocument(res.body);

      // 解析当前页图片(App 版)
      const imageNodes = doc.querySelectorAll(".comic-contain > .chapter-img");
      imageNodes.forEach((imgNode) => {
        let imgUrl = imgNode.querySelector(".comic-contain__item")?.attributes?.["data-src"];
        if (imgUrl) {
          const match = imgUrl.match(/^(https?:\/\/)?([^/\s:]+)(:\d+)?(\/[a-z]comic\/.*)/);
          if (match) {
            const domain = this.loadSetting("cdn_domains") === "" ? match[2] : this.loadSetting("cdn_domains");
            imgUrl = `${match[1]}${domain}${this.loadSetting("image_quality")}${match[4]}`;
          }
          images.push(imgUrl);
        }
      });
      return { images: images };
    },
  };
}

