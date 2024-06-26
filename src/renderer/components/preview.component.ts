import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy, Renderer2, ElementRef, RendererStyleFlags2, HostListener, ɵɵsetComponentScope } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription, BehaviorSubject } from 'rxjs';
import { PreviewService, SettingsService, ImageProviderService, IpcService, UserExceptionsService } from "../services";
import { PreviewData, PreviewDataApp, PreviewDataApps, PreviewVariables, AppSettings, ImageContent, SelectItem, UserConfiguration, ArtworkViewType, ArtworkType, isArtworkType, ImageProviderType } from "../../models";
import { APP } from '../../variables';
import { FileSelector } from '../../lib';
import { artworkTypes, artworkViewTypes, artworkViewNames, artworkDimsDict } from '../../lib/artwork-types';
import { superTypes, ArtworkOnlyType, superTypesMap } from '../../lib/parsers/available-parsers';
import { FuzzyTestPipe, IntersectionTestPipe } from '../pipes';
import * as url from '../../lib/helpers/url';
import * as FileSaver from 'file-saver';
import * as steam from '../../lib/helpers/steam';
import * as _ from 'lodash';
import * as path from 'path';
import { allProviders, imageProviderNames, multiLocalProviders, onlineProviders, providerCategories, singleLocalProviders } from '../../lib/image-providers/available-providers';

@Component({
  selector: 'preview',
  templateUrl: '../templates/preview.component.html',
  styleUrls: ['../styles/preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreviewComponent implements OnDestroy {
  previewData: PreviewData;
  appSettings: AppSettings;
  subscriptions: Subscription = new Subscription();
  previewVariables: PreviewVariables;
  missingArtFilter: boolean = false;
  showFilters: boolean = false;
  filterValue: string = '';
  categoryFilter: string[] = [];
  allCategories: string[] = [];
  actualCategoryFilter: string[] = [];
  parserFilter: string[] = [];
  allParsers: string[] = [];
  actualParserFilter: string[] = [];
  artworkSelectTypes: SelectItem[];
  scrollingEntries: boolean = false;
  fileSelector: FileSelector = new FileSelector();
  CLI_MESSAGE: BehaviorSubject<string> = new BehaviorSubject("");
  currentApp: {
    app: PreviewDataApp,
    userId: string,
    steamDirectory: string,
    appId: string
  }
  listImagesArtworkType: ArtworkType = 'tall';
  listSortBy: string = 'extractedTitle';
  showListImages: boolean = false;
  detailsApp: {
    app: PreviewDataApp,
    userId: string,
    steamDirectory: string,
    appId: string
  };
  matchFix: string = '';
  matchFixIds: string[] = []
  matchFixDict: {[sgdbId: string]: {name: string, posterUrl: string}};
  detailsLoading: boolean = true;
  showDetails: boolean = false;
  detailsSearchText: string = '';

  showExcludes: boolean = false;
  excludedAppIds: {
    [steamDirectory: string]: {
      [userId: string]: {
        [appId: string]: boolean
      }
    }
  } = {};
  excludePutBacks: {[exceptionKey: string]: boolean} = {};
  exclusionCount: number = 0;

  constructor(
    private previewService: PreviewService,
    private settingsService: SettingsService,
    private imageProviderService: ImageProviderService,
    private userExceptionsService: UserExceptionsService,
    private changeDetectionRef: ChangeDetectorRef,
    private renderer: Renderer2,
    private elementRef: ElementRef,
    private activatedRoute: ActivatedRoute,
    private fuzzyTest: FuzzyTestPipe,
    private intersectionTest: IntersectionTestPipe,
    private ipcService: IpcService
  ) {
    this.previewData = this.previewService.getPreviewData();
    this.previewVariables = this.previewService.getPreviewVariables();
    if(this.previewService.getPreviewData()) {
      this.allCategories = this.previewService.getAllCategories();
      this.allParsers = this.previewService.getAllParsers();
      this.previewData = this.previewService.getPreviewData();
    }
    this.appSettings = this.settingsService.getSettings();
    this.artworkSelectTypes = artworkViewTypes.map((artworkViewType: ArtworkViewType) => {
      return {value: artworkViewType, displayValue: artworkViewNames[artworkViewType]}
    });
    this.activatedRoute.queryParamMap.subscribe((paramContainer: any)=> {
      let params = ({...paramContainer} as any).params;
      if(params['cliMessage']) {
        this.CLI_MESSAGE.next(params['cliMessage']);
      }
    });
  }

  get lang() {
    return APP.lang.preview.component;
  }

  get artworkTypes() {
    return artworkTypes;
  }

  get artworkViewNames() {
    return artworkViewNames;
  }
  
  get providerCategories() {
    return providerCategories;
  }
  get allProviders() {
    return allProviders;
  }

  get imageProviderNames() {
    return imageProviderNames
  }

  isArtworkType(artworkViewType: ArtworkViewType) {
    return isArtworkType(artworkViewType)
  }

  generatePreviewData() {
    this.closeDetails();
    this.closeListImages();
    this.cancelExcludes();
    this.previewService.generatePreviewData();
  }

  preloadImages() {
    this.previewService.preloadImages();
  }



  setImageBoxSizes() {
    const currentViewType = this.previewService.getCurrentViewType();
    if(isArtworkType(currentViewType)) {
      this.renderer.setStyle(this.elementRef.nativeElement, '--image-width-max', artworkDimsDict[currentViewType].width, RendererStyleFlags2.DashCase);
      this.renderer.setStyle(this.elementRef.nativeElement, '--image-height-max', artworkDimsDict[currentViewType].height, RendererStyleFlags2.DashCase);
    }
  }

  setCategoryFilter(categories: string[]) {
    this.categoryFilter = categories;
    this.actualCategoryFilter = categories.map(c=>c.replace(/&nbsp;/g,' '));
  }

  setParserFilter(parsers: string[]) {
    this.parserFilter = parsers;
    this.actualParserFilter = parsers.map(p=>p.replace(/&nbsp;/g,' '));
  }

  ngAfterContentInit() {
    this.setImageSize(this.appSettings.previewSettings.imageZoomPercentage);
    this.setImageBoxSizes();
  }

  ngAfterViewInit() {
    this.subscriptions.add(this.previewService.getPreviewDataChange().subscribe(_.debounce(() => {
      this.allCategories = this.previewService.getAllCategories();
      this.allParsers = this.previewService.getAllParsers();
      this.previewData = this.previewService.getPreviewData();
      this.changeDetectionRef.detectChanges();
    }, 50)));
    this.subscriptions.add(this.CLI_MESSAGE.asObservable().subscribe((cliMessage: string)=> {
      const parsedCLI = cliMessage ? JSON.parse(cliMessage)||{} : {};
      let hasrun = false;
      if(['add','remove'].includes(parsedCLI.command)) {
        this.previewService.onLoadUserConfigurations((userConfigurations: UserConfiguration[])=> {
          this.ipcService.send('log','Generating app list')
          this.generatePreviewData();
        });
        this.previewService.getPreviewDataChange().subscribe(()=>{
          let previewVariables = this.previewService.getPreviewVariables();
          if(this.previewVariables.listHasGenerated && this.previewVariables.numberOfListItems > 0) {
            this.ipcService.send('inline-log',`Apps: ${this.previewVariables.numberOfListItems}. Remaining images: ${this.previewVariables.numberOfQueriedImages}`);
            if(this.previewVariables.numberOfQueriedImages == 0 && !hasrun) {
              hasrun = true;
              this.ipcService.send('log','')
              if(parsedCLI.command == 'add') {
                this.ipcService.send('log', 'Adding app list to steam');
                this.save().then(()=>{
                  this.ipcService.send('all_done');
                })
              } else {
                this.ipcService.send('log', 'Removing app list from steam');
                this.remove().then(()=>{
                  this.ipcService.send('all_done');
                })
              }
            }
          } else if(this.previewVariables.listHasGenerated){
            this.ipcService.send('log', 'No apps found');
            this.ipcService.send('all_done');
          }
        })
        this.previewService.getBatchProgress().subscribe(({update, batch}: {update: string, batch: number})=>{
          if(batch > -1) {
            this.ipcService.send('inline-log', update);
          }
        })
      }
    }))
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
  }

  getCurrentViewType() {
    return this.previewService.getCurrentViewType();
  }

  setImageType(artworkViewType: ArtworkViewType) {
    this.previewService.setCurrentViewType(artworkViewType);
    this.setImageBoxSizes();
    this.closeListImages();
    this.changeDetectionRef.detectChanges();
  }

  getImagePool(poolKey: string, artworkType?: ArtworkType) {
    return this.previewService.getImages(artworkType)[poolKey];
  }

  getAppImages(app: PreviewDataApp, artworkType?: ArtworkType) {
    const currentViewType = this.previewService.getCurrentViewType();
    const actualArtworkType: ArtworkType = isArtworkType(currentViewType) ? currentViewType : artworkType
    return app.images[actualArtworkType];
  }

  getBackgroundImage(app: PreviewDataApp, artworkType?: ArtworkType) {
    return this.previewService.getCurrentImage(app, artworkType);
  }
  getBackgroundImageList(app: PreviewDataApp, index: number, artworkType?: ArtworkType){
    return this.previewService.getImage(app, index, artworkType)
  }

  setDetailsBackgroundImage(sgdbId: string) {
    const posterUrl = this.matchFixDict[sgdbId].posterUrl;
    return posterUrl ? posterUrl : require('../../assets/images/no-images.svg');
  }

  setBackgroundImage(app: PreviewDataApp, image: ImageContent, artworkType?: ArtworkType, imageIndex?: number) {
    const currentViewType = this.previewService.getCurrentViewType();
    if (image == undefined) {
      const actualArtworkType: ArtworkType = isArtworkType(currentViewType) ? currentViewType : artworkType
      let imagepool: string = app.images[actualArtworkType].imagePool;
      if (this.previewService.getImages(actualArtworkType)[imagepool].online)
        return require('../../assets/images/retrieving-images.svg');
      else
        return require('../../assets/images/no-images.svg');
    }
    else {
      if (image.loadStatus === 'notStarted') {
        if(isArtworkType(currentViewType)) {
          this.loadImage(app)
        } else {
          this.loadImage(app, artworkType, imageIndex);
        }
        return require('../../assets/images/downloading-image.svg');
      }
      else if (image.loadStatus === 'downloading') {
        return require('../../assets/images/downloading-image.svg');
      }
      else if (image.loadStatus === 'done')
        return image.imageUrl;
      else
        return require('../../assets/images/failed-image-download.svg');
    }
  }

  loadImage(app: PreviewDataApp, artworkType?: ArtworkType, imageIndex?: number) {
    this.previewService.loadImage(app, artworkType, imageIndex);
  }

  areImagesAvailable(app: PreviewDataApp, artworkType?: ArtworkType) {
    return this.previewService.areImagesAvailable(app, artworkType);
  }

  currentImageIndex(app: PreviewDataApp, artworkType?: ArtworkType) {
    const currentViewType = this.previewService.getCurrentViewType();
    const actualArtworkType: ArtworkType = isArtworkType(currentViewType) ? currentViewType : artworkType
    return app.images[actualArtworkType].imageIndex + 1;
  }

  maxImageIndex(app: PreviewDataApp, artworkType?: ArtworkType) {
    return this.previewService.getTotalLengthOfImages(app, artworkType);
  }

  addLocalImages(app: PreviewDataApp, artworkType?: ArtworkType) {
    this.fileSelector.multiple = true;
    this.fileSelector.accept = '.png, .jpeg, .jpg, .tga, .webp';
    const currentViewType = this.previewService.getCurrentViewType();
    const actualArtworkType: ArtworkType = isArtworkType(currentViewType) ? currentViewType : artworkType;
    this.fileSelector.onChange = (target) => {
      if (target.files) {
        let extRegex = /png|tga|jpg|jpeg|webp/i;
        for (let i = 0; i < target.files.length; i++) {
          if (extRegex.test(path.extname(target.files[i].path))) {
            let imageUrl = url.encodeFile(target.files[i].path);
            this.previewService.addUniqueLocalImage(app.images[actualArtworkType].imagePool, {
              imageProvider: imageProviderNames.manual,
              imageUrl: imageUrl,
              loadStatus: 'done'
            },actualArtworkType, 'manual');
            this.previewService.setImageIndex(app, this.previewService.getTotalLengthOfImages(app, actualArtworkType, true) -1, actualArtworkType, true);
          }
        }
      }
    };
    this.fileSelector.trigger();
  }

  stopImageRetrieving() {
    this.imageProviderService.instance.stopUrlDownload();
  }

  save() {
    return this.previewService.saveData({removeAll: false, batchWrite: true});
  }

  remove() {
    for (const directory in this.previewData) {
      for (const userId in this.previewData[directory]) {
        for (const appId in this.previewData[directory][userId].apps) {
          this.previewData[directory][userId].apps[appId].status = 'remove';
        }
      }
    }
    return this.previewService.saveData({removeAll: false, batchWrite: false}).then((noError: boolean | void) => {
      if (noError)
        this.previewService.clearPreviewData();
    });
  }

  toggleFilters() {
    if(this.showFilters) {
      this.showFilters = false;
      this.renderer.setStyle(this.elementRef.nativeElement,'--filters-width','0%',RendererStyleFlags2.DashCase);
    } else {
      this.showFilters = true;
      this.renderer.setStyle(this.elementRef.nativeElement, '--filters-width', '300px', RendererStyleFlags2.DashCase);
    }
    this.changeDetectionRef.detectChanges();
  }

  setArtFilter(artFilter: boolean) {
    this.missingArtFilter = artFilter;
    this.changeDetectionRef.detectChanges();
  }

  searchMatches(searchTitle: string) {
    this.previewService.getMatchFixes(searchTitle).then((games: any[])=>{
      this.matchFixDict = Object.fromEntries(games.map((x: any)=>[x.id.toString(), {name: x.name, posterUrl: x.posterUrl}]));
      this.matchFixIds = games.map((x:any)=>x.id.toString());
      this.detailsLoading = false;
      this.changeDetectionRef.detectChanges();
    })
  }
  searchForDetails() {
    if(this.detailsSearchText) {
      this.searchMatches(this.detailsSearchText);
    }
  }
  changeAppDetails(app: PreviewDataApp, steamDirectory: string, userId: string, appId: string) {
    this.cancelExcludes();
    this.closeListImages();
    this.detailsLoading = true;
    this.showDetails= true;
    this.matchFix = '';
    this.renderer.setStyle(this.elementRef.nativeElement, '--details-width', '50%', RendererStyleFlags2.DashCase);
    this.changeDetectionRef.detectChanges()
    this.detailsApp = {
      appId: appId,
      app: app,
      steamDirectory: steamDirectory,
      userId: userId
    };
    this.searchMatches(this.detailsApp.app.extractedTitle);
  }

  fixMatch(sgdbId: string) {
    this.matchFix = sgdbId;
  }
  closeDetails() {
    this.detailsSearchText = '';
    this.matchFix = '';
    this.detailsApp = undefined;
    this.showDetails = false;
    this.renderer.setStyle(this.elementRef.nativeElement, '--details-width','0%', RendererStyleFlags2.DashCase);
    this.detailsLoading = false;
  }

  getImageRanges(app: PreviewDataApp, artworkType?: ArtworkType) {
    return this.previewService.getRanges(app, artworkType);
  }

  openListImages(app: PreviewDataApp, steamDir: string, userId: string, appId: string) {
    this.closeDetails();
    this.cancelExcludes();
    this.showListImages = true;
    this.renderer.setStyle(this.elementRef.nativeElement, '--list-images-width', '50%', RendererStyleFlags2.DashCase);
    this.currentApp={
      app: app,
      appId: appId,
      steamDirectory: steamDir,
      userId: userId
    };
    this.changeDetectionRef.detectChanges()

  }
  closeListImages() {
    this.currentApp = undefined;
    this.showListImages = false;
    this.renderer.setStyle(this.elementRef.nativeElement, '--list-images-width','0%',RendererStyleFlags2.DashCase);
  }

  saveDetails() {
    if(this.detailsApp && this.matchFix) {
      const {steamDirectory, userId, appId, app} = this.detailsApp;
      this.previewData[steamDirectory][userId].apps[appId].title = this.matchFixDict[this.matchFix].name;
      if(superTypesMap[app.parserType] !== 'ArtworkOnly') {
        const changedId = steam.generateAppId(app.executableLocation, this.matchFixDict[this.matchFix].name);
        this.previewData[steamDirectory][userId].apps[appId].changedId = changedId;
      }
      const newPool = `\$\{gameid:${this.matchFix}\}`
      for(const artworkType of artworkTypes) {
        const oldPool = this.previewData[steamDirectory][userId].apps[appId].images[artworkType].imagePool;
        this.previewData[steamDirectory][userId].apps[appId].images[artworkType].imagePool = newPool;
        this.previewData[steamDirectory][userId].apps[appId].images[artworkType].singleProviders.steam = undefined;
        this.previewService.updateAppImages(newPool, oldPool, artworkType)
      }
      let exceptionId;
      if(superTypes[ArtworkOnlyType].includes(app.parserType)) {
        exceptionId = app.executableLocation.replace(/\"/g,"");
      } else {
        exceptionId = steam.generateShortAppId(app.executableLocation, app.extractedTitle)
      }
      this.userExceptionsService.addExceptionById(exceptionId, app.extractedTitle, {
        newTitle: this.matchFixDict[this.matchFix].name,
        searchTitle: newPool,
        commandLineArguments: '',
        exclude: false,
        excludeArtwork: false
      })
      if(!isArtworkType(this.previewService.getCurrentViewType())) { 
        for(const artworkType of artworkTypes) {
          this.refreshImages(this.previewData[steamDirectory][userId].apps[appId], artworkType)
        }
      } else {
        this.refreshImages(this.previewData[steamDirectory][userId].apps[appId]);
      }
      this.closeDetails();
    }
  }

  excludeAppId(steamDirectory: string, userId: string, appId: string, override?: boolean) {
    if(this.showExcludes) {
      if(!this.excludedAppIds[steamDirectory]) {
        this.excludedAppIds[steamDirectory] = {};
      }
      if(!this.excludedAppIds[steamDirectory][userId]) {
        this.excludedAppIds[steamDirectory][userId] = {};
      }
      if(override === undefined) {
        if(this.excludedAppIds[steamDirectory][userId][appId]) {
          this.excludedAppIds[steamDirectory][userId][appId] = false;
          this.exclusionCount -= 1;
        } else {
          this.excludedAppIds[steamDirectory][userId][appId] = true;
          this.exclusionCount += 1;
        }
      } else {
        if(!override != !this.excludedAppIds[steamDirectory][userId][appId]) {
          this.exclusionCount += override ? 1 : -1;
        }
        this.excludedAppIds[steamDirectory][userId][appId] = override;
      }
    }
  }

  isAppVisible(app: PreviewDataApp) {
    const searchFilter = this.fuzzyTest.transform(app.title, this.filterValue);
    const categoryFilter = this.intersectionTest.transform(app.steamCategories, this.actualCategoryFilter);
    const configFilter = this.intersectionTest.transform([app.configurationTitle], this.actualParserFilter);
    let missingArtFilter;
    const currentViewType = this.previewService.getCurrentViewType();
    if(!this.missingArtFilter) {
      missingArtFilter = true;
    } else {
      if(isArtworkType(currentViewType)) {
        missingArtFilter = !this.previewService.getCurrentImage(app)
      }
      else {
        missingArtFilter = artworkTypes.map(t => !this.previewService.getCurrentImage(app,t)).reduce((x,y)=>x||y);
      }
    }
    const excludesArtOnlyFilter = !this.showExcludes || superTypesMap[app.parserType]!=='ArtworkOnly'
    return searchFilter && categoryFilter && configFilter && missingArtFilter && excludesArtOnlyFilter;
  }

  excludeVisible() {
    for(let steamDirectory in this.previewData) {
      for(let userId in this.previewData[steamDirectory]) {
        for(let appId in this.previewData[steamDirectory][userId].apps) {
          if(this.isAppVisible(this.previewData[steamDirectory][userId].apps[appId])) {
            this.excludeAppId(steamDirectory, userId, appId, true);
          }
        }
      }
    }
  }

  includeVisible() {
    for(let steamDirectory in this.previewData) {
      for(let userId in this.previewData[steamDirectory]) {
        for(let appId in this.previewData[steamDirectory][userId].apps) {
          if(this.isAppVisible(this.previewData[steamDirectory][userId].apps[appId])) {
            this.excludeAppId(steamDirectory, userId, appId, false);
          }
        }
      }
    }
  }

  showExclusions() {
    this.closeDetails();
    this.closeListImages();
    this.renderer.setStyle(this.elementRef.nativeElement, '--excludes-lower-width', '50%', RendererStyleFlags2.DashCase);
    this.showExcludes = true;
  }

  cancelExcludes() {
    this.showExcludes = false;
    this.renderer.setStyle(this.elementRef.nativeElement, '--excludes-lower-width', '0%', RendererStyleFlags2.DashCase);

    this.excludedAppIds = {};
    this.exclusionCount = 0;
  }

  saveExcludes() {
    let exceptionKeys: {exceptionId: string, extractedTitle: string}[] = [];
    for(const steamDirectory in this.previewData) {
      if(this.excludedAppIds[steamDirectory]) {
        for(const userId in this.previewData[steamDirectory]) {
          if(this.excludedAppIds[steamDirectory][userId]) {
            let newKeys = Object.keys(this.excludedAppIds[steamDirectory][userId]).filter((appId: string)=> {
              return !!this.excludedAppIds[steamDirectory][userId][appId]
            }).map((appId: string) =>{
              const app = this.previewData[steamDirectory][userId].apps[appId];
              const exceptionId = steam.generateShortAppId(app.executableLocation, app.extractedTitle)
              return {exceptionId: exceptionId, extractedTitle: app.extractedTitle}
            });
            exceptionKeys = exceptionKeys.concat(newKeys)
            this.previewData[steamDirectory][userId].apps = _.pickBy(this.previewData[steamDirectory][userId].apps, (value: PreviewDataApp, key: string) => {
              return !this.excludedAppIds[steamDirectory][userId][key]
            })
          }
        }
      }
    }
    for(const exceptionKey of exceptionKeys) {
      this.userExceptionsService.addExceptionById(exceptionKey.exceptionId, exceptionKey.extractedTitle, {
        newTitle: '',
        searchTitle: '',
        commandLineArguments: '',
        exclude: true,
        excludeArtwork: false
      })
    }
    const putBackKeys = Object.keys(this.excludePutBacks).filter(putBackKey=>this.excludePutBacks[putBackKey]);
    for(const putBackKey of putBackKeys) {
      this.userExceptionsService.putBack(putBackKey);
      delete this.excludePutBacks[putBackKey];
    }
    this.cancelExcludes();
    this.generatePreviewData();
  }

  refreshImages(app: PreviewDataApp, artworkType?: ArtworkType) {
    if(!isArtworkType(this.previewService.getCurrentViewType())) {
      this.previewService.downloadImageUrls(artworkType, [app.images[artworkType].imagePool]);
    } else {
      //TODO why are we refreshing all artwork types here
      for(const artworkType of artworkTypes) {
        this.previewService.downloadImageUrls(artworkType,[app.images[artworkType].imagePool]);
      }
    }
  }

  saveImage(image: ImageContent, title: string) {
    FileSaver.saveAs(image.imageUrl, title.replace(/[/\\?%*:|"<>]/g, '-'))
  }

  previousImage(app: PreviewDataApp, artworkType?: ArtworkType) {
    const currentViewType = this.previewService.getCurrentViewType();
    const actualArtworkType: ArtworkType = isArtworkType(currentViewType) ? currentViewType : artworkType;
    this.previewService.setImageIndex(app, app.images[actualArtworkType].imageIndex - 1, actualArtworkType);
  }

  nextImage(app: PreviewDataApp, artworkType?: ArtworkType) {
    const currentViewType = this.previewService.getCurrentViewType();
    const actualArtworkType: ArtworkType = isArtworkType(currentViewType) ? currentViewType : artworkType;
    this.previewService.setImageIndex(app, app.images[actualArtworkType].imageIndex + 1, actualArtworkType);
  }

  chooseImage(app: PreviewDataApp, imageIndex: number, artworkType?: ArtworkType) {
    const currentViewType = this.previewService.getCurrentViewType();
    const actualArtworkType: ArtworkType = isArtworkType(currentViewType) ? currentViewType : artworkType;
    this.previewService.setImageIndex(app, imageIndex, actualArtworkType);

  }

  setImageSizeFromInput(target: EventTarget, save: boolean = false) {
    this.setImageSize(Number((target as HTMLInputElement).value), save)
  }

  private setImageSize(value: number, save: boolean = false) {
    if (this.elementRef && this.elementRef.nativeElement) {
      if (typeof value === 'string') {
        value = parseFloat(value);
      }
      value = Math.min(Math.max(value, 30), 100);
      this.appSettings.previewSettings.imageZoomPercentage = value;
      if (save) {
        this.settingsService.saveAppSettings();
      }
      this.renderer.setStyle(this.elementRef.nativeElement, '--preview-image-size', value / 100, RendererStyleFlags2.DashCase);
    }
  }

  onScrollEnd = _.debounce(() => {
    this.scrollingEntries = false;
    this.changeDetectionRef.detectChanges();
  }, 150);

  onScroll() {
    this.scrollingEntries = true;
    this.onScrollEnd();
  }

  sortedAppIds(apps: PreviewDataApps) {
    return Object.keys(apps).sort((a,b)=>(apps[a][this.listSortBy as keyof PreviewDataApp] as string).localeCompare(apps[b][this.listSortBy as keyof PreviewDataApp] as string))
  }

  niceAppTitle(app: PreviewDataApp) {
    if(superTypesMap[app.parserType] == 'ArtworkOnly') {
      return app.title
    }
    return `${app.title} (${app.filePath})`
  }

  async exportSelection() {
    await this.previewService.exportSelection();
  }

  async importSelection() {
    await this.previewService.importSelection();
  }
}