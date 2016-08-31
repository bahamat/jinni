#!/usr/bin/env node --abort-on-uncaught-exception

var fs = require('fs');
var path = require('path');
var process = require('process');

var Client = require('irc-client');
var https = require('https');
var bunyan = require('bunyan');

var log = bunyan.createLogger({name: 'jinni'});
var config = loadConfig();

// The holdout object will keep track of when the last time an issue was
// commented on, on a per-room basis. The keys of holdout will be used as
// the list of rooms to join.
var holdout = {};
config.channels.forEach(function (chan) {
    holdout[chan] = {};
});
var holdout_time = 180000; // ms

// This is mostly boilerplate.
// See https://github.com/deoxxa/irc-client
/* jsl:ignore */
var Greeter = function Greeter() { /* jsl:end */
    Client.apply(this, arguments);

    this.regexes_private = [];
    this.regexes_public = [];

    this.on('message:public', function (from, to, message) {
        this.regexes_public.filter(function (regex) {
            var matches;
            /* jsl:ignore */
            if (matches = regex[0].exec(message)) { /* jsl:end */
                regex[1](from, to, message, matches);
            }
        }.bind(this));
    }.bind(this));

    // Commented out, because I'm not supporting private messages yet.
    // this.on('message:private', function (from, to, message) {
        // this.regexes_private.filter(function (regex) {
            // var matches;
            // if (matches = regex[0].exec(message)) {
                // regex[1](from, to, message, matches);
            // }
        // }.bind(this));
    // }.bind(this));

    this.transfers = [];
};

Greeter.prototype = Object.create(Client.prototype, {properties:
    {constructor: Greeter}});

Greeter.prototype.match_private = function match_private(regex, cb) {
    this.regexes_private.push([regex, cb]);
};

Greeter.prototype.match_public = function match_public(regex, cb) {
    this.regexes_public.push([regex, cb]);
};

Greeter.prototype.match = function match(regex, cb) {
    this.match_private(regex, cb);
    this.match_public(regex, cb);
};

var greeter = new Greeter({
    server: {host: 'irc.freenode.net', port: 6667},
    nickname: config.nickname,
    username: config.username,
    realname: config.realname,
    channels: config.channels
});

greeter.on('irc', function (message) {
    log.info(message);
});

// This is the reply. Commented out because I don't need it.
// greeter.match(/^(hey|hi|hello)/i, function (from, to, message, matches) {
//     var target = to;
//
//     if (target.toLowerCase() === greeter.nickname.toLowerCase()) {
//         target = from;
//     }
//
//     greeter.say(target, 'no, ' + matches[1] + ' to YOU, ' + from.nick);
// });

// End boilerplate.

/* jsl:ignore */
/* JSSTYLED */
var issue_re = new RegExp(/(https?:\/\/smartos.org\/bugview\/)?\b([A-Z]+-\d+)\b(.*)?/);
/* jsl:end */
greeter.match(issue_re, function checkIssue(from, to, message, matches) {

    var target = to;
    var issue = matches[2];
    var i = holdout[to][issue] || {};
    var last_code  = i.code || 0;
    var last_time  = i.time || 0;
    var now = new Date();
    var addtl_text = matches[3] || '';
    var addtl_match = addtl_text.match(issue_re) || [null, null, null];
    var url = matches[1] || '';

    log.info({from: from, to: to, message: message,
        last_time: last_time, last_code: last_code,
        matches: matches}, 'Need to look up a ticket');

    // Look for any additional matches in the remainder of the text.
    if (addtl_match[1] !== null) {
        log.info({matches: addtl_match}, 'Looking up additional matches');
        checkIssue(from, to, addtl_text, addtl_match);
    }

    // If this matches the bugview URL, skip it.
    if (url.match(/^http/)) {
        log.info({matches: matches[1]}, 'Looks like a pasted URL, ignoring.');
        return (0);
    }

    if (target.toLowerCase() === greeter.nickname.toLowerCase()) {
        target = from;
    }

    log.info('Check URL https://smartos.org/bugview/' + issue);
    https.get('https://smartos.org/bugview/' + issue, function (res) {
        log.info({issue: issue, statusCode: res.statusCode});
        if (res.statusCode !== last_code ||
                now - last_time > holdout_time) {

            switch (res.statusCode) {
            case 200:
                greeter.say(target,
                'https://smartos.org/bugview/' + matches[2]);
                break;
            case 403:
                greeter.say(target, 'Sorry, '
                + issue + ' is not public.');
                break;
            default:
                log.info({issue: issue, res: res}, 'No reply');
                break;
            }
            holdout[to][issue] = {time: now, code: res.statusCode};
        } else {
            /* JSSTYLED */
            log.info('Waiting an additional %d  seconds before replying for %s in %s',
                (last_time - now + holdout_time) / 1000,
                    issue, to);
        }
    }).on('error', function (e) {
        log.error(e);
    });
    return (0);
});

var changelog_re = new RegExp('^' + greeter.nickname.toLowerCase()
    + ':? changelog');
greeter.match(changelog_re, function (from, to, message, matches) {
    var target = to;
    log.info({from: from, to: to, message: message,
        matches: matches});
    if (target.toLowerCase() === greeter.nickname.toLowerCase()) {
        target = from;
    }

    /* JSSTYLED */
    greeter.say(target, 'http://us-east.manta.joyent.com/Joyent_Dev/public/SmartOS/smartos.html');

});

/* jsl:ignore */
function loadConfig() {
    var configPath = path.join(__dirname, 'config.json');

    if (!fs.existsSync(configPath)) {
        log.error('Config file not found: ' + configPath +
            ' does not exist. Aborting.');
        process.exit(1);
    }

    var theConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    log.debug('Configuration loaded');
    return (theConfig);
}
/* jsl:end */
