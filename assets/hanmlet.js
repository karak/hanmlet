jQuery(function () {
  //ページが開くと同時に自働フォーカスする。
  document.forms.form0.isbn13.focus();
});

/* global $, jQuery, Clipboard, Handlebars, Sanitize */
var templateSource, template, sanitizeHtml;

/***************************************/
/* app                                 */
/***************************************/
//form handler
document.forms.form0.onsubmit = function (e) {
  e.preventDefault();
  
  try {
    render();
  } finally {
    return false;
  }
};

//入力エリア
// - フォーカス時自働全選択
document.forms.form0.isbn13.onfocus = function () {
  this.select();
}

// - フォーカスがはずれると同時に実行。
document.forms.form0.isbn13.onchange = function () {
  render();
  //覚書：submitはonsubmitをcallしないので直接実行。validateもされない。
};


//clipboard
new Clipboard('#copy-to-clipboard-button');

//to render
function compileTemplate (template) {
  return Handlebars.compile(template);
}
templateSource = $('#entry-template').html().trim();
template = compileTemplate(templateSource);

//template area
document.forms.form0.customTemplate.value = templateSource;

document.forms.form0.useCustomTemplate.onchange = function () {
	if (this.checked) {
    $('#template-area').show();
  } else {
    $('#template-area').hide();  	
  }
};



sanitizeHtml = (function () {
  var s = new Sanitize({
  	elements: ['p', 'br', 'b', 'i', 'strong', 'em', 'small', 'sup', 'sub', 'tt']
  });
  
  return function (html) {
    var fragment = s.clean_node($('<div>', {html: html}).get(0));
    return $(fragment).text();
  };
}());

/* フォームの記述を元に画面を生成する。 */
function render() {
	var amazonUrlPattern = new RegExp('https?://www.amazon.co.jp/*.'),
	    form = document.form0,
        useCustomTemplate = form.useCustomTemplate.checked,
        customTemplate = useCustomTemplate? form.customTemplate.value : null,
        thisTemplateFn = useCustomTemplate? compileTemplate(customTemplate) : template,
        inputIsbn = form.isbn13.value.trim(),
        useOriginalImage = form.useOriginalImage.checked,
        isbn,
        pageUrl,
        thumbnailUrl;

  //リセット。  
  $('#error-messages').html('');
  $('#entry-container').html('読み込み中...');
  $('#source').val('');
    
  if (inputIsbn === '') {
    $('#entry-container').html('');
    return;
  }

  if (inputIsbn.match(amazonUrlPattern)) {
    //Case: Amazon URL
    isbn = convertToIsbn13(getAsin(inputIsbn));
  } else {
    //Case: ISBN-10/13
    inputIsbn = inputIsbn.replace(/-/g, '');
    if (inputIsbn.length === 13) {
      isbn = inputIsbn;
    } else if (inputIsbn.length === 10) {
      isbn = convertToIsbn13(inputIsbn);
    } else {
      $('#error-messages').html('ISBNは13桁か10桁で入力してください（ハイフン可）。');
      return;
    }
  }
  
  //この時点で13桁のみ対応
  if (isbn.length !== 13 || !isbn.match(/[0-9]{12}[0-9X]/)) {
    $('#error-messages').html('ISBNの書式が正しくありません');
    return;
  }
  
  //めんどいので日本の書籍のみ対応
  if (isbn.substring(0, 4) !== '9784') {
    $('#error-messages').html('ISBNの冒頭は9784（13桁）または4（13桁）である必要があります。');
    return;
  }
  
  //ISBNから書籍詳細ページURLを生成する。
  pageUrl = generateDetailPageUrl(isbn);
  
  //ISBNから画像URLを生成する。
  if (useOriginalImage) {
    thumbnailUrl = generateOriginalImageUrl(isbn, 110);
  } else {
    thumbnailUrl = generateResizedImageUrl(isbn, 110, undefined);
  
	  //FIXME: ISBNの出版社コードが４桁のとき以外、縮小画像が取得できない！
  }
  
  //書誌情報を取得する。  
  requestBook(isbn).done(function (book) {
    var html;
    
    //データにサムネール画像などを足す
    $.extend(book, {
    	thumbnailUrl: thumbnailUrl,
    	pageUrl: pageUrl
    });

    //テンプレートにデータを流し込んで、HTMLを生成する。
    html = thisTemplateFn(book);

    //プレビューを更新する。
    $('#entry-container').html(html);

    //ソースを更新する。
    $('#source').val(html);
    
    //ボタンにフォーカス（スクロール）
    $('#copy-to-clipboard-button').focus();
  }).
  fail(function () {
    $('#entry-container').html('書誌情報の取得に失敗');
    $('#source').val('');
  });
}

/***************************************/
/* hanmoto.com
 * API仕様は http://www.hanmoto.com/hanmotocom-webapi */
/***************************************/

function requestBook(isbn) {
  var deferred = $.Deferred();
  
  $.ajax({
  	method: 'GET',
    dataType: 'xml',
    url: '//www.hanmoto.com/api/book.php?ISBN=' + isbn
  }).
  done(function (bookXml) {
    //console.log(bookXml);

    var $book = $(bookXml),
        $product = $book.find('Product'),
        $desc = $product.find('DescriptiveDetail'),
        $collat = $product.find('CollateralDetail'),
        $pub = $product.find('PublishingDetail'),
        $price = $product.find('ProductSupply> SupplyDetail > Price'),
        count = parseInt($book.find('Head > total').text(), 10), 
        title = $desc.children('TitleDetail').
                      filter(function (i, item) { return $(item).children('TitleType').text() === '01'; }).
                      children('TitleElement').
                      filter(function (i, item) { return $(item).children('TitleElementLevel').text() === '01'; }).
                      children('TitleText').
                      text(),
        contributors = $desc.children('Contributor').
                       map(function (i, item) {
                       	 var $item = $(item),
                             role = $item.children('ContributorRole').text(),
                             name = $item.children('PersonName').text(),
                             roleLetter;
                         
                         switch (role) {
                           //http://www.kinkan.info/wp/wp-content/uploads/2012/11/ONIX_Books_Product_2.1_rev04_translated_in_JP.pdf
                           //「PR8. 著者」を参照。
                           //「リスト17」の訳がどこにあるのか不明。
                           // https://www.medra.org/stdoc/onix-codelist-17.htm
                           case 'A01':
                             roleLetter = '著';
                             break;
                           case 'B01':
                             roleLetter = '編';
                             break;
                           case 'B06':
                             roleLetter = '訳';
                             break;
                           case 'B08':
                             roleLetter = '編・訳';
                             break;
                           case 'B10':
                             roleLetter = '訳・注';
                             break;
                           default:
                             roleLetter = 'その他';
                             break;
                         }
                         
                         return name + '（' + roleLetter + '）';
                       }).
                       get(),
        description = $collat.children('TextContent').
                      filter(function (i, item) { return $(item).children('TextType').text() === '03'; }).
                      children('Text').
       						    map(function (i, item) {
                        var $item = $(item),
                            textformat = $item.attr('textformat'),
                            data = $item.text(); //CDATA

                        switch (textformat) {
                          case '02':
                            //HTMLなので危険なタグを除去する。
                            return sanitizeHtml(data);
                          default:
                            return null;
                        }
                      }).get(0),  
        publisher = $pub.children('Publisher').
                         filter(function (i, item) { return $(item).children('PublishingRole').text() === '01'; }).
                         children('PublisherName').
                         text(),
        imprint = $pub.children('Imprint').
                       children('ImprintName').
                       text(),
        pubDate = $pub.children('PublishingDate').
                       filter(function (i, item) { return $(item).children('PublishingDateRole').text() === '01'; }).
                       children('Date').
        						   map(function (i, item) {
                         var $item = $(item),
                             dateformat = $item.attr('dateformat'),
                             text = $item.text();

                             if (text.length > 0) {
                               switch (dateformat) {
                                 case undefined:
                                 case '00':
                                   return new PDate(parseInt(text.substring(0, 4), 10), parseInt(text.substring(4, 6), 10), parseInt(text.substring(6, 8), 10));
                                 //TODO: other formats
                                 default:
                                   return new PDate();
                               }
                             } else {
                               //dateformatまで指定しておきながらテキストが空のことがある（「鷲の巣」など）
                               return new PDate();
                             }
                       }).get(0),
        price = $price.filter(function (i, item) { return $(item).children('PriceType').text() === '03'; }).
                       map(function (i, item) {
                         var $item = $(item),
                             amount = $item.children('PriceAmount').text(),
                             currencyCode = $item.children('CurrencyCode').text();
                             
                         if (currencyCode === 'JPY') {
                           return amount + '円';
                         } else {
                           return amount + ' '+ currencyCode;
                         }
                       }).get(0);
    
    if (count > 0) {
	    deferred.resolve({
      	title: title,
        author: contributors.join('，'),
        description: description, //これのみHTML
        imprint: imprint,
        publisher: publisher,
        pubDate: pubDate.toString(),
        price: price
      });
    } else {
      deferred.reject();
    }
  }).
  fail(function () {
  	deferred.reject();
  });
  
  return deferred.promise();

}

//ItemLookup API
//こちらはクロスドメイン制約があるので使えない。
//$.ajax に crossDomain: true を与えてもNG.
//'//www.hanmoto.com/api/Operation=ItemLookup&ItemId=' + hyphenateIsbn(isbn) + '&enc=UTF-8';

function generateDetailPageUrl(isbn) {
	return 'http://www.hanmoto.com/bd/isbn/' + isbn;
}

function generateResizedImageUrl(isbn, width, height) {
  /*
  URL仕様
  http://www.hanmoto.com/bd/img/image.php/[ファイル名]?width=[表示したいサイズの横幅]&image=/bd/img/[ファイル名の出版社記号部分]/[ファイル名]
  */
  var isbnHyphenated = hyphenateIsbn(isbn), //ハイフン区切りのISBN
      fileName = isbnHyphenated + '.jpg', //ファイル名。jpg固定？
      publisherCode = isbnHyphenated.split('-')[2], //出版社記号部分。ハイフン区切りの3番目
      url;
      
  //console.log(fileName);
  //console.log(publisherCode);
  
  url = 'http://www.hanmoto.com/bd/img/image.php/' + fileName + '?';
  if (width !== undefined) {
  	url += 'width=' + width;
  }
  if (height !== undefined) {
    url += 'height=' + height;
  }
  url += '&image=/bd/img/' + publisherCode + '/' + fileName;
  return url;
}

/* 上のAPIが期待通り動作しないので、下でサイズ指定する。ただし高さ固定では指定できない。 */

function generateOriginalImageUrl(isbn, width) {
  if (width === undefined) {
  	width = 0; //原寸大
  }
	return 'http://www.hanmoto.com/bd/img/' + isbn + '_' + width +'.jpg'; //jpg固定
}


/***************************************/
/* ISBN                                */
/***************************************/

function hyphenateIsbn(isbn) {
	var l3 = computePublisherCodeLength(isbn), //出版社コード部分の長さ
        lengths = [ 3, 1, l3, 8 - l3, 1 ], //各部分の長さ
        parts = [],
        i, j;
      
   j = 0;
   for (i = 0; i < lengths.length; i++) {
     parts.push(isbn.substring(j, j + lengths[i]));
   	 j += lengths[i];
   }
   return parts.join('-'); //ハイフンでつなぐ
}

function computePublisherCodeLength(isbn) {
  /*
  桁数 出版社コード
  2	00-19
  3	200-699
  4	7000-8499
  5	85000-89999
  6	900000-949999
  7	9500000-9999999
  */
  var code = parseInt(isbn.substring(4, 4 + 7), 10);
  if (code < 2000000) {
    return 2;
  } else if (code < 7000000) {
	  return 3;
  } else if (code < 8500000) {
  	return 4;
  } else if (code < 9000000) {
    return 5;  
  } else if (code < 9500000) {
    return 6;
  } else {
    return 7;
  }
}

//! AmazonのURLからASINを取得する。
function getAsin(url) {
  var pattern1 = new RegExp('^https?://www.amazon.co.jp.*?/dp/([0-9X]*)/?.*'),
      pattern2 = new RegExp('^https?://www.amazon.co.jp.*?/gp/product/([0-9X]*)/?.*'),
      match = (url.match(pattern1) || url.match(pattern2)),
      asin = match !== null? match[1] : '';
  return asin;
}

function convertToIsbn13(isbn10) {
    var tmp0 = isbn10.substring(0, 9), //ISBN-10のチェックディジットを除去。
        tmp1 = '978' + tmp0, //固定の接頭記号をつける。
        cd = computeIsbnCheckDigit(tmp1, false), //あらためてチェックディジットを計算。
        isbn13 = tmp1 + cd; //チェックディジットを付加。
    console.log(isbn10 + ' => ' + isbn13);
    
    return isbn13;
}

/* ISBNのチェックディジットを計算。*/
function computeIsbnCheckDigit(isbn, Xor0) {
    var i, d, sum;
    
    sum = 0;
    for (i = 0; i < isbn.length; i++) {
        d = toDigit(isbn[i]);
        if (i % 2 === 0) {
            sum += d * 1;
        } else {
            sum += d * 3;
        }
    }
    
    return fromDigit(10 - (sum % 10));
    
    function toDigit(char) {
        if (char !== 'X' || char !== '0') {
            return parseInt(char, 10);
        } else {
            return 10;
        }
    }
    
    function fromDigit(d) {
        if (d !== 10) {
            return d.toString(10);
        } else {
            return (Xor0? 'X' : '0');
        }
    }
}

/***************************************/
/* Date                                */
/***************************************/
function PDate(year, month, day) {
  switch (arguments.length) {
    case 0:
      this.year = this.month = this.day = null;
      break;
    case 1:
      this.year = year;
      this.month = this.day = null;
      break;
    case 2:
      this.year = year;
      this.month = month;
      this.day = null;
      break;
    case 3:
      this.year = year;
      this.month = month;
      this.day = day;
      break;
    default:
      throw 'arguments error';
  }
}

PDate.prototype.toString = function () {
	return (this.year !== null ? this.year + '年' : '') + (this.month !== null ? this.month + '月' : '') + (this.day !== null ? this.day + '日' : '');
};