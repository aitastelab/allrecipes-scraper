#!/usr/bin/env node
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const readline = require('readline');
const pLimit = require('p-limit');
const cliProgress = require('cli-progress');
const { Command } = require('commander');
const ProxyAgent = require('proxy-agent');

const axiosRetry = async (url, options = {}, retries = 3, delay = 1000) => {
  const proxy = process.env.HTTP_PROXY || '';
  const agent = proxy ? new ProxyAgent(proxy) : undefined;
  options.httpsAgent = agent;
  options.httpAgent = agent;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await axios.get(url, options);
    } catch (error) {
      if (attempt < retries) {
        console.warn(`Retry ${attempt}/${retries} for ${url}...`);
        await new Promise(res => setTimeout(res, delay * attempt));
      } else {
        throw error;
      }
    }
  }
};

class AllRecipesScraper {
  constructor() {
    this.baseUrl = 'https://www.allrecipes.com';
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
  }

  async fetchPage(url) {
    try {
      const response = await axiosRetry(url, {
        headers: { 'User-Agent': this.userAgent }
      });
      return response.data;
    } catch (error) {
      console.error(`Error fetching ${url}: ${error.message}`);
      return null;
    }
  }

  async searchRecipes(query, page = 1) {
    const searchUrl = `${this.baseUrl}/search/results/?search=${encodeURIComponent(query)}&page=${page}`;
    const html = await this.fetchPage(searchUrl);
    if (!html) return [];

    const $ = cheerio.load(html);
    const recipes = [];

    $('.card__recipe').each((index, element) => {
      const $element = $(element);
      const title = $element.find('.card__title').text().trim();
      const link = this.baseUrl + $element.find('a').attr('href');
      const image = $element.find('img').attr('src') || $element.find('img').attr('data-src');
      const rating = parseFloat($element.find('.review-star-text').text()) || 0;
      const reviewCount = parseInt($element.find('.recipe-review-count').text()) || 0;

      recipes.push({ title, link, image, rating, reviewCount });
    });

    return recipes;
  }

  async scrapeRecipe(url) {
    const html = await this.fetchPage(url);
    if (!html) return null;

    const $ = cheerio.load(html);
    const title = $('h1').text().trim();
    const ingredients = [];
    $('.ingredients-item').each((i, el) => ingredients.push($(el).text().trim()));
    const instructions = [];
    $('.instructions-section-item').each((i, el) => instructions.push($(el).find('.paragraph').text().trim()));
    const image = $('.recipe-image img').attr('src');

    return {
      title,
      ingredients: ingredients.join('||'),
      instructions: instructions.join('||'),
      image,
      url
    };
  }

  saveToJSON(recipes, filename) {
    fs.writeFileSync(filename, JSON.stringify(recipes, null, 2));
    console.log(`Saved ${recipes.length} recipes to ${filename}`);
  }
}

const program = new Command();
program
  .option('-s, --search <term>', 'Search term (e.g., chicken)')
  .option('-d, --details', 'Scrape full recipe details')
  .option('--json', 'Save to JSON');

program.parse(process.argv);
const options = program.opts();

(async () => {
  const scraper = new AllRecipesScraper();
  if (options.search) {
    const results = await scraper.searchRecipes(options.search, 1);
    console.log(`Found ${results.length} recipes:`);
    results.forEach((r, i) => console.log(`${i + 1}. ${r.title}`));
    if (options.details) {
      const limit = pLimit(3);
      const detailed = await Promise.all(results.slice(0, 5).map(r => limit(() => scraper.scrapeRecipe(r.link))));
      if (options.json) scraper.saveToJSON(detailed, 'recipes.json');
    }
  } else {
    console.log("👋 Welcome to AllRecipes Scraper!");
    console.log('Run with --search "term" to begin.');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Press Enter to exit...", () => rl.close());
  }
})();
