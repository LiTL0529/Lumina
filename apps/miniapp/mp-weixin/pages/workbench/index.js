const app = getApp();

Page({
  data: {
    h5Url: '',
  },
  onLoad() {
    const base = app.globalData.apiBase.replace('/api/v1', '');
    this.setData({ h5Url: `${base}/m/workbench` });
  },
});
