var os = require('os');
var http = require('http');
var toobusy = require('toobusy');

// Linux std. uptime data collection
// The numbers are calculated every 5 secs.

// @todo Is it possible to check, whether this is a cluster and then ONLY load
// stuff when we are in the master process?

// How this should work:
// - detect mode: cluster or standalone
// - if running like standalone, but cluster detected: throw
// - if running like cluster, but is standalone, run as standalone
//
// The reason for throw'ing, when running as standalone in cluster setup, is
// that we will only be able to show a single process' info.
//
// Problems:
// - It's "easy" to detect cluster in standalone mode, but not vice versa

var cluster = require('cluster');

var _singleton = null;
var StatsServer = function(config) {
  // Handle if this is being treated as a function, instead of an object
  if(!(this instanceof StatsServer)) return new StatsServer(config);
  // Work in a singleton style way
  if(_singleton) return _singleton;
  _singleton = this;

  this.data = { };
  this.config = config || { port: 8181 };

  this.getBasicInfo();

  this.setupMessageListeners();
  this.startHttpServer();
};
module.exports = StatsServer;

StatsServer.prototype.setupMessageListeners = function() {
  if(cluster.isMaster) {
    cluster.on('online', this.startListeningToWorker.bind(this));
    cluster.on('exit', this.stopListeningToWorker.bind(this));
    statsTimer = setInterval(this.requestStats, 5000);
  }
};

StatsServer.prototype.startListeningToWorker = function(worker) {
  console.log('starting to listen');
  worker.on('message', this.messageHandler.bind(this));
  worker.send({ cmd: 'stats-server:send stats' });
};

StatsServer.prototype.stopListeningToWorker = function(worker) {
  worker.removeListener('message', this.messageHandler.bind(this));
};

StatsServer.prototype.requestStats = function() {
  if(cluster.isMaster && cluster.workers) {
    for(var id in cluster.workers) {
      cluster.workers[id].send({ cmd: 'stats-server:send stats' });
    }
  }
};

StatsServer.prototype.messageHandler = function(msg) {
  if(msg.cmd && (msg.cmd == 'stats-server:stats')) {
    cluster.workers[ msg.data.id ].stats = msg.data;
  }
};

StatsServer.prototype.startHttpServer = function() {
  if(cluster.isMaster) {
    this.server = http.createServer();
    this.server.listen(this.config.port);
    this.server.on('request', this.handleRequest.bind(this));

    console.log('Stats server listening on port '+this.config.port);
  }
};

StatsServer.prototype.handleRequest = function(request, response) {
console.log('before');
  this.aggregateStats();
console.log('after');
  var format = 'json';

  if(request.url.match(/format=(html|json)/)) {
    format = request.url.replace(/format=([a-z]+)/, '$1').toLowerCase();
  }
  if(format === 'html') {
    response.setHeader('Content-Type', 'text/html');
    response.write('<html>\n<body>\n');
    for(var key in this.data) {
      response.write(key + ': ' + this.data[key] + '<br />\n');
    }
    response.write('\n</body>\n</html>');
    response.end();
  } else {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(this.data, null, 2));
  }
};

StatsServer.prototype.getBasicInfo = function() {
  // Get basic info on this process
  this.data.os = {
    type: os.type(),
    release: os.release(),
    platform: os.platform(),
    hostname: os.hostname()
  };
  this.data.system = {
    pid: process.pid,
    architecture: os.arch(),
    node_version: process.version, // Node.js version
    cpus: os.cpus()
  };
};

StatsServer.prototype.aggregateStats = function() {
  var masterMem = process.memoryUsage();

  this.data.processes = { '0': {
    memory: process.memoryUsage(),
    id: 0,
    pid: process.pid,
    uptime: process.uptime(),
    filename: process.argv[1]
  }};

  this.data.aggregated = {};
  this.data.apps = {};

  this.data.aggregated = {
    loadavg: os.loadavg(),
    totalmem: os.totalmem(),
    freemem: os.freemem(),
    usedmem: (os.totalmem() - os.freemem()),
    cpus: os.cpus().length,
    processes: 1,
    workers: 0,
    rss: masterMem.rss,
    heapTotal: masterMem.heapTotal,
    heapUsed: masterMem.heapUsed
  };

  for(var id in cluster.workers) {
    this.data.aggregated.processes++;

    if(cluster.workers[id].stats != undefined) {
      var workerStats = cluster.workers[id].stats;

      this.data.processes[workerStats.id] = workerStats;

      if(this.data.apps[workerStats.filename] == undefined) { this.data.apps[workerStats.filename] = { workers: 0, rss: 0, heapTotal: 0, heapUsed: 0 }; }

      this.data.apps[workerStats.filename].workers++;
      this.data.apps[workerStats.filename].rss += workerStats.memory.rss;
      this.data.apps[workerStats.filename].heapTotal += workerStats.memory.heapTotal;
      this.data.apps[workerStats.filename].heapUsed += workerStats.memory.heapUsed;

      this.data.aggregated.workers++;
      this.data.aggregated.rss += workerStats.memory.rss;
      this.data.aggregated.heapTotal += workerStats.memory.heapTotal;
      this.data.aggregated.heapUsed += workerStats.memory.heapUsed;
    }
  }
};

if(cluster.isWorker && cluster.worker) {
  process.on('message', function(msg) {
    if(msg.cmd && (msg.cmd == 'stats-server:send stats')) {
      process.send({ cmd: 'stats-server:stats', data: { memory: process.memoryUsage(), id: cluster.worker.id, pid: process.pid, uptime: process.uptime(), filename: process.argv[1] } });
    }
  });
}



// var loopLag = 0;
// server.on('connection', function() {
//   loopLag = toobusy.lag();
// });

// var statsServer =
// statsServer.listen(config.statsServer.port);
// console.log('Stats server listening on port '+config.statsServer.port);
