/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const { St, Clutter, Graphene, Pango } = imports.gi;
const Calendar = imports.ui.calendar;
const MessageTray = imports.ui.messageTray;
const MessageList = imports.ui.messageList;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;
let _extension;

function getMode() {
    return _extension.expandMode;
}

function setExpandMode(mode) {
    _extension.expandMode = mode;
}

function isOpen(){
    return Main.panel.statusArea.dateMenu.menu.isOpen;
}
// Create a new layout, using the same settings as the banners, the height of a line and the calculated width 
function initiateLayout(message) {
    message.pangoLayout = message.bodyLabel.clutter_text.create_pango_layout(message.bodyLabel._text);
    message.pangoLayout.set_wrap(Pango.WrapMode.WORD_CHAR);
    message.pangoLayout.set_justify(true);
    
    const heightPango = message._bodyStack.get_height() * Pango.SCALE;
    
    const widthButton = message._closeButton.get_width();
    const widthIcon = message._iconBin.get_width();
    // This is the offset. The width of the message list is allocated, however we need to correct by an offset
    let offset = widthIcon;
    if (getMode() !== "AUTO") {
        // Add offset of button twice, because the padding is almost equal to a button width
        offset += 2 * widthButton;
    }
    const widthPango = Main.panel.statusArea.dateMenu._messageList.get_width() * Pango.SCALE - offset * Pango.SCALE;
    message.pangoLayout.set_height(heightPango);
    message.pangoLayout.set_width(widthPango);
}

function applyExtensionToMessage(message) {
    // Saving the height of the actionBin prematurely since there exists a bug
    message.actionBinHeight = message._actionBin.get_height();
    // Initiate a layout, that gives number of lines
    initiateLayout(message);
    let expandButton = null;
    // Make sure we need to expand at all. Either the notification has a body and enough lines to expand, or it has actions
    if ((message._bodyText && (message.pangoLayout.get_line_count() > 1)) || message.notification.actions.length !== 0 ||
        (message._buttonBox && message._buttonBox.get_n_children() > 0)) {
        // When expanding automatically
        if (getMode() === "AUTO") {
            message.forceExpansion = true;
            message.expand(true);
        }
        else {
            // The icon we need
            let arrowIcon = null;
            // When in mode CRITICAL and notification is critical 
            if (getMode() === "CRITICAL" && message.notification.urgency === 3) {
                arrowIcon = PopupMenu.arrowIcon(St.Side.BOTTOM);
            }
            else {
                arrowIcon = PopupMenu.arrowIcon(St.Side.RIGHT);
            }
            // Create the button
            expandButton = new St.Button({
                child: arrowIcon,
                y_align: Clutter.ActorAlign.START,
                x_align: Clutter.ActorAlign.END,
            });
            // In able to align the arrow next to the description, a new BoxLayout has to be created
            let newBox = new St.BoxLayout({
                vertical: false,
            });
            // Re-creating the widget message._bodyStack and adding it to the new box as well as the expand button
            let newWidget = new St.Widget({ x_expand: true, x_align: Clutter.ActorAlign.START });
            newWidget.layout_manager = new MessageList.LabelExpanderLayout();
            let newBodyLabel = new MessageList.URLHighlighter('', false, message._useBodyMarkup);
            newBodyLabel.add_style_class_name('message-body');
            newWidget.add_actor(newBodyLabel);
            newBox.add(newWidget);
            newBox.add(expandButton);
            // Remove old bodyStack
            message.child.get_first_child().get_children()[1].remove_actor(message._bodyStack);
            message._bodyStack = newWidget;
            message.bodyLabel = newBodyLabel;
            message.setBody(message._bodyText);
            // Inserting newBox at the correct position
            message.child.get_first_child().get_children()[1].insert_child_at_index(newBox, 2);
            // Connecting button to signal
            expandButton.connect('clicked', () => {
                if (message.expanded === true) {
                    // Everything needed to unexpand. Make sure arrow is correctly aligned, change the icon of arrow, then unexpand
                    expandButton.remove_actor(arrowIcon);
                    arrowIcon = PopupMenu.arrowIcon(St.Side.RIGHT);
                    expandButton.add_actor(arrowIcon);
                    message.clickedByButton = true;
                    message.keepActions = false;
                    message.unexpand(true);
                }
                else {
                    // Make sure to keep the arrow aligned at the top of the notification, so it does not move
                    expandButton.remove_actor(arrowIcon);
                    arrowIcon = PopupMenu.arrowIcon(St.Side.BOTTOM);
                    expandButton.add_actor(arrowIcon);
                    message.clickedByButton = true;
                    message.expand(true);
                }
            });
            // Expand CRITICAL notifications here
            if (getMode() === "CRITICAL" && message.notification.urgency === 3) {
                message.forceExpansion = true;
                message.expand(true);
            }
        }
    }
}

function _onNotificationAdded(source, notification) {
    // The important line of the extension is this one. Here, usually a Object of the class NotificationMessage would be created.
    // However, by using NotificationBanner, access to more functions is granted. Also, the style for banners includes styling
    // for actions.
    let message = notification.createBanner();
    // NotificationBanners are too wide for the notification tray, so they have to be adjusted properly
    message.set_width(31.5);
    message.add_style_class_name('expandable');
    message.setSecondaryActor(new Calendar.TimeLabel(notification.datetime));
    let isUrgent = notification.urgency == MessageTray.Urgency.CRITICAL;

    let updatedId = notification.connect('updated', () => {
        message.setSecondaryActor(new Calendar.TimeLabel(notification.datetime));
        this.moveMessage(message, isUrgent ? 0 : this._nUrgent, this.mapped);
    });

    if (isUrgent) {
        // Keep track of urgent notifications to keep them on top
        this._nUrgent++;
    } else if (this.mapped) {
        // Only acknowledge non-urgent notifications in case it
        // has important actions that are inaccessible when not
        // shown as banner
        notification.acknowledged = true;
    }
    let index = isUrgent ? 0 : this._nUrgent;
    let destroyId = notification.connect('destroy', () => {
        notification.disconnect(destroyId);
        notification.disconnect(updatedId);
        if (isUrgent)
            this._nUrgent--;
    });
    this.addMessageAtIndex(message, index, this.mapped);
    if(isOpen()) {
        applyExtensionToMessage(message);
    }
}

function expand(animate) {
    // Save oldBoxHeight so it can be put back when unexpanding
    this.oldBoxHeight = this.get_parent().get_height();
    this.expanded = true;
    this._actionBin.visible = this._actionBin.get_n_children() > 0;

    if (this._bodyStack.get_n_children() < 2) {
        this._expandedLabel = new MessageList.URLHighlighter(this._bodyText,
            true, this._useBodyMarkup);
        this.setExpandedBody(this._expandedLabel);
    }

    if (animate) {
        if (!this.clickedByButton && !this.forceExpansion) {
            this._bodyStack.ease_property('@layout.expansion', 1, {
                progress_mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                duration: MessageTray.ANIMATION_TIME,
            });
        }
        else if (this.clickedByButton || this.forceExpansion) {
            let fix = 0;
            if (this._actionBin.get_height() !== 0) {
                // When expanding a notif for the second time, a bug exists that resets the height
                // of the actionBin. The height is saved when to this.actionBinHeight when inserting the message to notification list
                this._actionBin.set_height(this.actionBinHeight);
            }
            if (!this._bodyText) {
                // There is a weird issue with notifications without descriptions. A small part of the actionBin ends up being cut. This is a fix.
                fix = this._bodyStack.get_height();
            }
            else if (!this.nLinesSet) {
                this._bodyStack.layout_manager._expandLines = this.pangoLayout.get_line_count();
                this.nLinesSet = true;
            }
            else {
                this._bodyStack.layout_manager._expandLines = this.pangoLayout.get_line_count();
            }
            // Expand, set height and update layout manager. This is important for the ScrollView
            this._bodyStack.layout_manager.expansion = 1;
            this.get_parent().set_height(this.get_height() + fix);
            this.get_parent().layout_manager.layout_changed();
            this.expanded = true;
        }
        this._actionBin.scale_y = 0;
        this._actionBin.ease({
            scale_y: 1,
            duration: MessageTray.ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    } else {
        this._bodyStack.layout_manager.expansion = 1;
        this._actionBin.scale_y = 1;
    }
    this.emit('expanded');
}

function unexpand(animate) {
    if (animate) {
        this._bodyStack.ease_property('@layout.expansion', 0, {
            progress_mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            duration: MessageTray.ANIMATION_TIME,
        });
        if (!this.keepActions) {
            this._actionBin.ease({
                scale_y: 0,
                duration: MessageTray.ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this._actionBin.hide();
                    this.expanded = false;
                },
            });
        } else {
            this.expanded = false;
        }
        // This if-clause is new
        if (this.clickedByButton) {
            this._bodyStack.layout_manager.expansion = 0;
            this._actionBin.scale_y = 0;
            this.get_parent().set_height(this.oldBoxHeight);
            this.get_parent().layout_manager.layout_changed();
            this.expanded = false;
        }
    } else {
        this._bodyStack.layout_manager.expansion = 0;
        if (!this.keepActions) this._actionBin.scale_y = 0;
        this.expanded = false;
    }
    this.emit('unexpanded');
}
// Messages are expanded or get a button as soon as notification list is opened
function _onOpenStateChanged(menu, open) {
    _originalOnOpenStateChanged.apply(this, [menu, open]);
    // If there are notifications in the list and the Clock Popover is open
    if (open && !Main.panel.statusArea.dateMenu._messageList._notificationSection.empty) {
        for (const messageParent of Main.panel.statusArea.dateMenu._messageList._notificationSection._list) {
            let message = messageParent.child;
            // If message already has layout
            if (message.pangoLayout) {
                continue;
            }
            // Apply extension based on mode
            applyExtensionToMessage(message);
        }
    }
}

// These variables are used to store original functions
let _originalOnNotificationAdded;
let originalExpand;
let originalUnexpand;
let _originalOnOpenStateChanged;
let settingsHandler = null;
let _onOpenStateChangedSignalId = 0;
class Extension {
    constructor(uuid) {
        this._uuid = uuid;
        ExtensionUtils.initTranslations(Me.metadata['gettext-domain']);
    }
    enable() {
        // Enable settings
        this.settings = ExtensionUtils.getSettings(Me.metadata['settings-schema']);
        // Get original functions
        _originalOnNotificationAdded = Calendar.NotificationSection.prototype._onNotificationAdded;
        originalExpand = MessageList.Message.prototype.expand;
        originalUnexpand = MessageList.Message.prototype.unexpand;
        _originalOnOpenStateChanged = Main.panel.statusArea.dateMenu._onOpenStateChanged;
        // Connecting to key of settings
        this.expandMode = this.settings.get_string('expand-mode');
        settingsHandler = this.settings.connect('changed::expand-mode', () => {
            setExpandMode(this.settings.get_string('expand-mode'));
        });
        // Replace function called on signal with custom function
        _onOpenStateChangedSignalId = Main.panel.statusArea.dateMenu.menu.connect('open-state-changed', _onOpenStateChanged.bind(Main.panel.statusArea.dateMenu));
        // Replace original functions with new ones
        Calendar.NotificationSection.prototype._onNotificationAdded = _onNotificationAdded;
        MessageList.Message.prototype.expand = expand;
        MessageList.Message.prototype.unexpand = unexpand;
    }
    disable() {
        // Disconnect custom function, add back old one
        Main.panel.statusArea.dateMenu.menu.disconnect(_onOpenStateChangedSignalId);
        Main.panel.statusArea.dateMenu.menu.connect('open-state-changed', _originalOnOpenStateChanged.bind(Main.panel.statusArea.dateMenu));
        // Put back original functions
        Calendar.NotificationSection.prototype._onNotificationAdded = _originalOnNotificationAdded;
        MessageList.Message.prototype.expand = originalExpand;
        MessageList.Message.prototype.unexpand = originalUnexpand;
        this._destroy();
        this._extension = null;
        this.settings = null;
    }
    _destroy() {
        this.settings.disconnect(settingsHandler);
    }
}

function init(meta) {
    _extension = new Extension(meta.uuid);
    return _extension;
}
