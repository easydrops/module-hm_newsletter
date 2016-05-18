/**
 * Extend Number functions and add pad function to
 * allow leading zeros.
 */
Number.prototype.pad = function (size) {
  var s = String(this);
  while (s.length < (size || 2)) {
    s = "0" + s;
  }
  return s;
};

(function ($, Drupal, window, document) {
  /**
   * Harbourmaster Newsletter object.
   * @constructor
   */
  function HmNewsletter(context) {
    if($(context).is('.hm_newsletter')) {
      this.$wrapper = $(context);
    }
    else {
      this.$wrapper = $('.hm_newsletter', context);
    }
    this.$perms = this.$wrapper.find('.hm_newsletter__permissions');
    this.$form = this.$wrapper.find('form');
    this.$alerts = this.$wrapper.find('.hm_newsletter__alerts');
    this.$success = this.$wrapper.find('.hm_newsletter__success');
    this.$error = this.$wrapper.find('.hm_newsletter__error');
    this.$privacy = this.$wrapper.find('.hm_newsletter__privacy');

    this.$wrapper.addClass('initialized')
  }

  // Static vars and functions
  $.extend(HmNewsletter, {
    STATE_INITIAL: 'state-initial',
    STATE_PRIVACY: 'state-privacy',
    STATE_SUCCESS: 'state-success',
    // TODO: Maybe save the permissions just once and reuse it
    permissions: null,
    // Global list of possible fields.
    fields: {
      salutation: null,
      firstname: null,
      lastname: null,
      postalcode: null,
      city: null,
      dateofbirth: null,
      email: null,
    },
    // Interpret error messages returned from thsixty
    responseInterpreter: function (responseData) {
      var interpretedResponse = {
        code: responseData.code,
        field: null,
        message: null
      };

      switch (responseData.code) {
        case 'EmailCannotBeEmpty':
          interpretedResponse.field = 'email';
          interpretedResponse.message = 'Die E-Mail-Adresse ist erforderlich.';
          break;
        case 'InvalidEmail':
          interpretedResponse.field = 'email';
          interpretedResponse.message = 'Die E-Mail-Adresse muss gültig sein.';
          break;
        default:
          interpretedResponse.message = responseData.code.replace(/([A-Z])/g, ' $1');
          break;
      }

      return interpretedResponse;
    }
  });

  /**
   * Bind clicks on more-links accordion-like behaviour.
   */
  HmNewsletter.prototype.bindMoreLinks = function () {
    var $thisObj = this;
    // Open more text div.
    $thisObj.$perms.find('.text-hidden-toggle').once().on('click', function (e) {
      // Click should no affect label checkbox.
      e.preventDefault();
      if (!$(this).hasClass('visible')) {
        $thisObj.setViewState(HmNewsletter.STATE_PRIVACY)
      }
      else {
        $thisObj.setViewState(HmNewsletter.STATE_INITIAL)
      }
    });

    $thisObj.$privacy.find('.icon-close').click(function(e) {
      $thisObj.setViewState(HmNewsletter.STATE_INITIAL)
    })
  };

  /**
   * Submit function for newsletter
   */
  HmNewsletter.prototype.bindSubmit = function () {

    var $thisObj = this;
    this.$form.on('submit', $.proxy(function (pEvent) {

      pEvent.preventDefault();

      // On submission we remove old alerts.
      $thisObj.removeAlerts();

      var valid = true;
      var user = {};

      // Get userdata from fields.
      $.each(HmNewsletter.fields, function (index) {
        var field = $thisObj.formField(index);
        // Get the value from the field, if it exists.
        if (field.length) {
          var val = field.val();
          user[index] = val;
          // When the field is required, the value must not be empty.
          if (val === '' && field.attr('required')) {
            $thisObj.addAlert('danger', index, 'Das Feld ist erforderlich.');
            valid = false;
          }
          // Check for valid email address.
          var regex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}/igm;
          if ((index == 'email' && val.length > 0) && !regex.test(val)) {
            $thisObj.addAlert('danger', index,
              'Bitte überprüfen Sie die Eingabe der E-Mail Adresse.');
            valid = false;
          }
        }
      });

      // Get groups from form.
      var groups = [];
      $thisObj.$form.find('[name="groups[]"]:checked').each(function () {
        groups.push($(this).val());
      });

      // Validate on selected newsletter - disabled to allow
      // sending form only subscribing to agreements.
      /*
       if (groups.length == 0) {
       $thisObj.addAlert('danger', 'groups[]', 'Bitte wählen Sie mindestens einen Newsletter aus.');
       }*/

      // Get day of birth from form and reformat data.
      var dob_day = parseInt($thisObj.$form.find('[name="dob_day"]').val());
      var dob_month = parseInt($thisObj.$form.find('[name="dob_month"]').val());
      var dob_year = parseInt($thisObj.$form.find('[name="dob_year"]').val());
      if (dob_day > 0 && dob_month > 0 && dob_year > 0) {
        user.dateofbirth = dob_year + '-' + (dob_month).pad() + '-' + (dob_day).pad();
      }

      // Build data for newsletter subscriptions - split up by clients/ groups.
      var client_groups = [];
      $.each(groups, function (index, value) {
        var group_data = value.split('_');
        if (group_data.length == 2) {
          if (client_groups[group_data[0]] === undefined) {
            client_groups[group_data[0]] = [];
          }
          client_groups[group_data[0]].push(group_data[1]);
        }
      });

      // Get client_id.
      var client_id = $thisObj.$form.find('[name="client_id"]').val();

      // Check if agreements where checked.
      var agreements = [];

      // Agreements.
      var $promo_permissions = $thisObj.$form.find('[name="promo_permission"]');
      jQuery.each($promo_permissions, function (index, elem) {
        if($(elem).is(':checked') === true) {
          var agreement = {
            "version": $(elem).data('version'),
            "name": $(elem).data('name')
          };
          agreements.push(agreement);
        }
      });

      // We only send request if groups or agreements are passed.
      if (valid && agreements.length === 0 && client_groups.length === 0) {
        $thisObj.addAlert('danger', 'promo_permission',
          'Bitte bestätigen Sie die Datenschutzeinwilligung.');
        valid = false;
      }

      var promises = [];
      // Send subscribe request with newsletters.
      if (valid && client_groups.length) {
        var data = {};
        // Send request for every client and it's subscribed groups.
        client_groups.forEach(function (value, index, arr) {
          data.client = index;
          data.groups = value;
          data.user = user;
          data.agreements = [];
          promises.push($thisObj.sendSubscribeRequest(data));
        });
      }

      // Send subscribe request for agreements..
      if (valid && agreements.length) {
        var data = {};
        data.client = parseInt(client_id);
        data.groups = [];
        data.user = user;
        data.agreements = agreements;
        promises.push($thisObj.sendSubscribeRequest(data));
      }
      
      if(valid) {
        $.when.apply($, promises).done(function() {
          $thisObj.showSuccess();
        }).fail(function(err) {
          $thisObj.showError(err);
        }).always(function(e) {
          $thisObj.scrollPage();
        })
      }

      return false;
    }, this));
  };

  /**
   * Scroll up page to actual form.
   */
  HmNewsletter.prototype.scrollPage = function () {
    var $thisObj = this;
    // Scroll page up to newsletter form.
    $('html, body').animate({
      scrollTop: $thisObj.$wrapper.offset().top-150
    }, 200);
  };

  /**
   * Adds alert to the newsletter form's alert section.
   *
   * @param type
   * @param field
   * @param message
   */
  HmNewsletter.prototype.addAlert = function (type, field, message) {

    // Mark field as error.
    if (type == 'danger' && field !== undefined) {
      this.setValidationState(this.formField(field), 'has-error');
    }
    var alertString = '<div class="alert alert-' + type + '" role="alert">' + message + '</div>';
    // Check if alertString already exists.
    var alertshtml = this.$alerts.html();
    if (alertshtml.indexOf(alertString) == -1) {
      this.$alerts.append(alertString);
    }
  };

  /**
   * Adds alert to the newsletter form's alert section.
   *
   * @param el
   * @param state
   */
  HmNewsletter.prototype.setValidationState = function (el, state) {
    el.parents('.form-group').addClass(state);
  };


  /**
   * Removes all alerts from the newsletter form allert section.
   */
  HmNewsletter.prototype.removeAlerts = function () {
    this.$alerts.html('');
    this.$form.find('.form-group').removeClass('has-error');
  };

  /**
   * Sets classes according to states, the view can be in
   * @param pState
   */
  HmNewsletter.prototype.setViewState = function (pState) {
    this.$wrapper.removeClass(HmNewsletter.STATE_PRIVACY + ' ' + HmNewsletter.STATE_SUCCESS);

    switch (pState) {
      case HmNewsletter.STATE_SUCCESS:
      case HmNewsletter.STATE_PRIVACY:
        this.$wrapper.addClass(pState);
        break;
    }
  }

  /**
   * Get the given form field.
   *
   * @param {string} field
   * @returns {*}
   */
  HmNewsletter.prototype.formField = function (field) {
    return this.$form.find('[name="' + field + '"]');
  };


  /**
   * Show success after subscribing to newsletter.
   */
  HmNewsletter.prototype.showSuccess = function () {
    // Reset complete form.
    this.$form.trigger("reset");
    this.setViewState(HmNewsletter.STATE_SUCCESS)

    this.$wrapper.trigger('newsletter:success')
  };

  /**
   * Show error after failed subscribtion to newsletter.
   */
  HmNewsletter.prototype.showError = function (err) {
    var responseData = BaseNewsletterView.responseInterpreter(err);
    this.addAlert('danger', responseData.field, responseData.message);

    this.setViewState(HmNewsletter.STATE_INITIAL)

    this.$wrapper.trigger('newsletter:error')
  };

  /**
   * Sends subscribe request with given data.
   * @param data
   */
  HmNewsletter.prototype.sendSubscribeRequest = function (data) {
    var $thisObj = this;
    var deferred = $.Deferred();

    window.thsixtyQ.push(['newsletter.subscribe', {
      params: data,
      success: function () {
        deferred.resolve()
      },
      error: $.proxy(function (err) {
          deferred.reject(err)
        }, this)
    }]);

    return deferred.promise()
  };

  /**
   * Get permission text from API.
   *
   * @return object
   */
  HmNewsletter.prototype.setPermissionTexts = function () {
    var $thisObj = this;
    window.thsixtyQ.push(['permissions.get', {
      success: function (permissions) {
        // Clean up markup in permissions wrapper.
        $thisObj.$perms.html('');
        // Show permissions.
        jQuery.each(permissions, function (index, value) {
          // For now we only show the privacy checkbox.
          if (index == 'datenschutzeinwilligung' || index == 'privacy') {
            // For now we fake the machine name of the permission - should be delivered ba service call also.
            var machine_name = index;
            var version = value.version;
            var markup = '<div class="checkbox"><label for="promo_permission_' + index + '">';
            markup += '<input data-version="' + version + '" data-name="' + machine_name + '" type="checkbox" name="promo_permission" class="promo_permission" id="promo_permission_' + index + '">';
            markup += value.markup.text_label;
            markup += '</label></div>';
            $thisObj.$perms.append(markup);

            if (index == 'datenschutzeinwilligung' && value.markup.text_body) {
              $thisObj.$privacy.find('.container-content-dynamic').empty().append(value.markup.text_body);
            }
          }
          // Form more-links.
          $thisObj.bindMoreLinks();
        });
      },
      error: function (err) {
        console.error(err)
      }
    }]);
  };

  /**
   * Bind the newsletter to Drupal.
   */
  Drupal.behaviors.hmNewsletter = {
    attach: function (context, settings) {
      if($('.hm_newsletter', context).hasClass('initialized') || $(context).is('.hm_newsletter.initialized')) return;

      var NL = new HmNewsletter(context);
      // Set permission texts.
      NL.setPermissionTexts();
      // Form submission.
      NL.bindSubmit();
    }
  };
})
(jQuery, Drupal, this, this.document);