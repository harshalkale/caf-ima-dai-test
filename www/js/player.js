'use strict';

const NAMESPACE = 'urn:x-cast:com.google.ads.ima.cast';

class Player {
    /**
     * Represents the receiver
     * @param {!Object} mediaElement - the cast media player element
     */
    constructor (mediaElement) {
        /**
         * The fallback stream to play if loading fails.
         * @type {string}
         * @private
         * @const
         */
        this.backupStream_ = 'http://storage.googleapis.com/testtopbox-public/' +
            'video_content/bbb/master.m3u8';

        /**
         * The cast context object provided by the CAF framework.
         * @type {!Object}
         * @private
         * @const
         */
        this.castContext_ = cast.framework.CastReceiverContext.getInstance();

        /**
         * The player manager object, provided by the CAF framework.
         * @type {!Object}
         * @private
         * @const
         */
        this.playerManager_ = this.castContext_.getPlayerManager();

        /**
         * The video player contained within the cast media player element.
         * @type {!HTMLMediaElement}
         * @private
         * @const
         */
        this.mediaElement_ = mediaElement.getMediaElement();

        /**
         * This is the stream manager object for IMA SDK.
         * @type {?Object}
         * @private
         */
        this.streamManager_ = null;

        /**
         * Stores the timestamp where playback will start, in seconds, for
         * bookmarking.
         * @type {number}
         * @private
         */
        this.startTime_ = 0;

        /**
         * Stores a flag to identify whether an ad is currently playing.
         * @type {boolean}
         * @private
         */
        this.adIsPlaying_ = false;
    }

    /** Initializes CAF and IMA SDK */
    initialize() {
        // Map of namespace names to their types.
        const options = new cast.framework.CastReceiverOptions();
        options.customNamespaces = {};
        options.customNamespaces[NAMESPACE] =
            cast.framework.system.MessageType.STRING;
        this.castContext_.start(options);
        this.streamManager_ =
            new google.ima.cast.dai.api.StreamManager(this.mediaElement_);
    }

    /** Attaches event listeners and other callbacks. */
    setupCallbacks() {
        // Receives messages from sender app.
        this.castContext_.addCustomMessageListener(NAMESPACE, (event) => {
            this.processSenderMessage_(event.data);
        });

        this.attachStreamManager_();
        this.attachAdBreakListeners_();
    }

    /**
     * Parses messages from sender apps. The message is a comma separated
     * string consisting of a function name followed by a set of parameters.
     * @param {string} message - The raw message from the sender app.
     * @private
     */
    processSenderMessage_(message) {
        const messageArray = message.split(',');
        const method = messageArray[0];
        switch (method) {
            case 'bookmark':
                const time = parseFloat(messageArray[1]);
                const bookmarkTime = this.streamManager_.contentTimeForStreamTime(time);
                this.broadcast('bookmark,' + bookmarkTime);
                this.bookmark(time);
                break;
            default:
                this.broadcast(`Message \'${method}\'not recognized`);
                break;
        }
    }

    /**
     * Attaches message interceptors and event listeners to connect IMA to CAF.
     * @private
     */
    attachStreamManager_() {
        const getStreamRequest = (request) => {
            const imaRequestData = request.media.customData;
            let streamRequest = null;
            if (imaRequestData.assetKey) {
                streamRequest = new google.ima.cast.dai.api.LiveStreamRequest();
                streamRequest.assetKey = imaRequestData.assetKey;
            } else {
                // Save startTime_ for VOD bookmarking.
                this.startTime_ = imaRequestData.startTime;
                streamRequest = new google.ima.cast.dai.api.VODStreamRequest();
                streamRequest.contentSourceId = imaRequestData.contentSourceId;
                streamRequest.videoId = imaRequestData.videoId;
            }
            return streamRequest;
        };
        this.playerManager_.setMessageInterceptor(
            cast.framework.messages.MessageType.LOAD, (request) => {
                return this.streamManager_
                    .requestStream(request, getStreamRequest(request))
                    .then((request) => {
                        if (this.startTime_) {
                            request.currentTime = this.startTime_;
                        }
                        return Promise.resolve(request);
                    })
                    .catch((error) => {
                        this.broadcast(
                            'Stream request failed. Loading backup stream...');
                        request.media.contentUrl = this.backupStream_;
                        return Promise.resolve(request);
                    });
            });
    }

    /**
     * Attaches CAF ad event managers.
     * @private
     */
    attachAdBreakListeners_() {
        this.playerManager_.addEventListener(
            cast.framework.events.EventType.BREAK_STARTED, () => {
                this.adIsPlaying_ = true;
            });
        this.playerManager_.addEventListener(
            cast.framework.events.EventType.BREAK_ENDED, () => {
                this.adIsPlaying_ = false;
            });
    }

    /**
     * Sets a bookmark to a specific time on future playback.
     * @param {number} time - The target stream time in seconds, including ads.
     */
    bookmark(time) {
        this.startTime_ = time;
    }

    /**
     * Broadcasts a message to all attached CAF senders
     * @param {string} message - The message to be sent to attached senders
     */
    broadcast(message) {
        console.log(message);
        this.castContext_.sendCustomMessage(NAMESPACE, undefined, message);
    }
}
