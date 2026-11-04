'use strict';
/**
 * Declarative definitions of every public application / request form.
 * One definition drives: the public form page, validation, insert,
 * the admin inbox (list / detail / status), the member "my requests" view
 * and the public tracker.
 *
 * Field types: text, email, tel, number, date, bsdate, textarea, select, radio, checkbox, file, image
 * `col` defaults to `name`. `show` = include in admin list columns.
 */

const BRANCH = { name: 'branch', label: ['शाखा', 'Branch'], type: 'select', optionsFrom: 'branches' };

const YES_NO = [['yes', 'हो', 'Yes'], ['no', 'होइन', 'No']];
const BUSINESS = { field: 'occupation', eq: 'business' };
const FAMILY_RELATIONS = [['father', 'बुबा', 'Father'], ['mother', 'आमा', 'Mother'], ['grandfather', 'हजुरबुबा', 'Grandfather'], ['spouse', 'पति/पत्नी', 'Spouse'], ['son', 'छोरा', 'Son'], ['daughter', 'छोरी', 'Daughter'], ['guardian', 'अभिभावक', 'Guardian'], ['other', 'अन्य', 'Other']];
const WELFARE = profiles => ({ field: 'claim_type', meta: 'profile', in: profiles });
const COOP_VISIT = { field: 'visit_kind', eq: 'cooperative' };

const GENDER = { name: 'gender', label: ['लिङ्ग', 'Gender'], type: 'radio', options: [['male', 'पुरुष', 'Male'], ['female', 'महिला', 'Female'], ['other', 'अन्य', 'Other']] };

const modules = {
  loan: {
    table: 'loan_applications', prefix: 'LN', icon: 'banknote', nameCol: 'full_name', phoneCol: 'mobile', memberCol: 'member_id',
    title: ['ऋण आवेदन', 'Loan application'],
    intro: ['आवश्यक विवरण भर्नुहोस्। हाम्रो कर्मचारीले २ कार्य दिनभित्र सम्पर्क गर्नेछन्।', 'Fill in the details. Our staff will contact you within 2 working days.'],
    sections: [
      { title: ['आवेदकको विवरण', 'Applicant'], fields: [
        { name: 'full_name', label: ['पूरा नाम', 'Full name'], required: true, show: true },
        { name: 'member_id', label: ['सदस्यता नं.', 'Membership no.'] },
        { name: 'mobile', label: ['मोबाइल', 'Mobile'], type: 'tel', required: true, show: true },
        { name: 'email', label: ['इमेल', 'Email'], type: 'email' },
        { name: 'citizenship_no', label: ['नागरिकता नं.', 'Citizenship no.'] },
        { name: 'address', label: ['ठेगाना', 'Address'], type: 'textarea', rows: 2, required: true },
        { name: 'occupation', label: ['पेशा', 'Occupation'] },
        { name: 'organization_name', label: ['कार्यरत संस्था', 'Employer / business'] },
        { name: 'monthly_income', label: ['मासिक आम्दानी (रु.)', 'Monthly income (Rs.)'], type: 'number' },
      ] },
      { title: ['ऋणको विवरण', 'Loan'], fields: [
        { name: 'loan_type', label: ['ऋणको प्रकार', 'Loan type'], type: 'select', required: true, show: true, optionsFrom: 'loanTypes' },
        { name: 'loan_amount', label: ['माग रकम (रु.)', 'Amount (Rs.)'], type: 'number', required: true, min: 1000, max: 1e10, show: true, format: 'money' },
        { name: 'loan_tenure', label: ['अवधि (महिना)', 'Tenure (months)'], type: 'number', min: 1, max: 360 },
        { name: 'repayment_method', label: ['भुक्तानी तरिका', 'Repayment'], type: 'select', options: [['monthly', 'मासिक किस्ता', 'Monthly EMI'], ['quarterly', 'त्रैमासिक', 'Quarterly'], ['onetime', 'एकमुष्ट', 'Lump sum']] },
        { name: 'loan_purpose', label: ['ऋणको उद्देश्य', 'Purpose'], type: 'textarea', rows: 3, required: true },
        { name: 'collateral_type', label: ['धितोको प्रकार', 'Collateral type'], type: 'select', options: [['land', 'जग्गा/घर', 'Land / house'], ['vehicle', 'सवारी साधन', 'Vehicle'], ['fd', 'मुद्दती निक्षेप', 'Fixed deposit'], ['gold', 'सुन/चाँदी', 'Gold / silver'], ['guarantee', 'व्यक्तिगत जमानी', 'Personal guarantee'], ['none', 'छैन', 'None']] },
        { name: 'collateral_value', label: ['धितोको अनुमानित मूल्य', 'Collateral value'], type: 'number' },
        { name: 'collateral_description', label: ['धितोको विवरण', 'Collateral details'], type: 'textarea', rows: 2 },
      ] },
      { title: ['जमानी', 'Guarantor'], fields: [
        { name: 'guarantor_name', label: ['जमानीको नाम', 'Guarantor name'] },
        { name: 'guarantor_relation', label: ['नाता', 'Relation'] },
        { name: 'guarantor_phone', label: ['फोन', 'Phone'], type: 'tel' },
        BRANCH,
        { name: 'documents', label: ['कागजात (PDF/फोटो)', 'Documents (PDF/photo)'], type: 'file', kind: 'any' },
      ] },
    ],
  },

  account: {
    table: 'account_applications', prefix: 'AC', icon: 'wallet', nameCol: 'full_name', phoneCol: 'mobile',
    title: ['अनलाइन खाता खोल्नुहोस्', 'Open an account online'],
    intro: ['फारम बुझाएपछि शाखामा आएर हस्ताक्षर र प्रमाणीकरण गर्नुहोस्।', 'After submitting, visit a branch to sign and verify.'],
    sections: [
      { title: ['खाता', 'Account'], fields: [
        { name: 'account_type', label: ['खाताको प्रकार', 'Account type'], type: 'select', required: true, show: true, optionsFrom: 'savingTypes' },
        BRANCH,
        { name: 'initial_deposit', label: ['सुरुको जम्मा (रु.)', 'Initial deposit (Rs.)'], type: 'number' },
      ] },
      { title: ['व्यक्तिगत विवरण', 'Personal'], fields: [
        { name: 'full_name', label: ['नाम (नेपालीमा)', 'Name (Nepali)'], required: true, show: true },
        { name: 'full_name_en', label: ['नाम (अंग्रेजीमा)', 'Name (English)'] },
        { name: 'dob_bs', label: ['जन्म मिति (वि.सं.)', 'Date of birth (BS)'], type: 'bsdate', adCol: 'dob_ad' },
        GENDER,
        { name: 'marital_status', label: ['वैवाहिक स्थिति', 'Marital status'], type: 'select', options: [['single', 'अविवाहित', 'Single'], ['married', 'विवाहित', 'Married'], ['other', 'अन्य', 'Other']] },
        { name: 'mobile', label: ['मोबाइल', 'Mobile'], type: 'tel', required: true, show: true },
        { name: 'email', label: ['इमेल', 'Email'], type: 'email' },
        { name: 'permanent_address', label: ['स्थायी ठेगाना', 'Permanent address'], type: 'textarea', rows: 2, required: true },
        { name: 'temporary_address', label: ['अस्थायी ठेगाना', 'Temporary address'], type: 'textarea', rows: 2 },
        { name: 'father_name', label: ['बुबाको नाम', "Father's name"] },
        { name: 'mother_name', label: ['आमाको नाम', "Mother's name"] },
        { name: 'occupation', label: ['पेशा', 'Occupation'] },
        { name: 'monthly_income', label: ['मासिक आम्दानी', 'Monthly income'] },
      ] },
      { title: ['नागरिकता र इच्छाएको व्यक्ति', 'Citizenship & nominee'], fields: [
        { name: 'citizenship_no', label: ['नागरिकता नं.', 'Citizenship no.'], required: true },
        { name: 'citizenship_issued_date', label: ['जारी मिति', 'Issued date'] },
        { name: 'citizenship_issued_place', label: ['जारी जिल्ला', 'Issued district'] },
        { name: 'nominee_name', label: ['इच्छाएको व्यक्ति', 'Nominee'] },
        { name: 'nominee_relation', label: ['नाता', 'Relation'] },
        { name: 'nominee_phone', label: ['फोन', 'Phone'], type: 'tel' },
      ] },
      { title: ['कागजात', 'Documents'], fields: [
        { name: 'photo', label: ['पासपोर्ट फोटो', 'Passport photo'], type: 'image' },
        { name: 'citizenship_front', label: ['नागरिकता (अगाडि)', 'Citizenship (front)'], type: 'image' },
        { name: 'citizenship_back', label: ['नागरिकता (पछाडि)', 'Citizenship (back)'], type: 'image' },
        { name: 'signature', label: ['हस्ताक्षर', 'Signature'], type: 'image' },
      ] },
    ],
  },

  kyc: {
    table: 'kyc_applications', prefix: 'KY', icon: 'id', nameCol: 'full_name', phoneCol: 'mobile', memberCol: 'member_id', amlCol: 'aml_details_json',
    title: ['अनलाइन केवाइएम (KYM)', 'Online KYM'], wide: true,
    intro: ['सहकारीको सदस्य सूचीमा दर्ता भएको सदस्यता नम्बर र मोबाइल नम्बरबाट मात्र केवाइएम भर्न सकिन्छ। पहिले भरिएको विवरण अद्यावधिक हुन्छ।',
      'Use the Member ID and mobile number registered with the cooperative. An existing KYM for the same Member ID is updated.'],
    sections: [
      { title: ['व्यक्तिगत विवरण', 'Personal information'], fields: [
        { name: 'member_id', label: ['सदस्यता नम्बर (Member ID)', 'Member ID'], required: true, show: true, hint: ['सहकारीको सदस्य सूचीमा भएको नम्बर मात्र', 'Must already be on the members list'] },
        { name: 'full_name', label: ['पूरा नाम (नेपालीमा)', 'Full name (Nepali)'], required: true, show: true },
        { name: 'full_name_en', label: ['पूरा नाम (अंग्रेजीमा)', 'Full name (English)'] },
        { name: 'dob_bs', label: ['जन्म मिति (वि.सं.)', 'Date of birth (BS)'], type: 'bsdate', adCol: 'dob_ad' },
        GENDER,
        { name: 'marital_status', label: ['वैवाहिक स्थिति', 'Marital status'], type: 'select', options: [['single', 'अविवाहित', 'Single'], ['married', 'विवाहित', 'Married'], ['divorced', 'सम्बन्धविच्छेद', 'Divorced'], ['widow', 'विधवा/विधुर', 'Widow/Widower']] },
        { name: 'nationality', label: ['राष्ट्रियता', 'Nationality'], default: 'नेपाली' },
      ] },
      { title: ['सम्पर्क र ठेगाना', 'Contact & address'], fields: [
        { name: 'mobile', label: ['मोबाइल नम्बर', 'Mobile number'], type: 'tel', required: true, show: true, pattern: /^9\d{9}$/, hint: ['सहकारीमा दर्ता भएकै मोबाइल', 'The mobile registered with the cooperative'] },
        { name: 'email', label: ['इमेल ठेगाना', 'Email address'], type: 'email', required: true },
        { name: 'permanent_address', label: ['स्थायी ठेगाना', 'Permanent address'], type: 'address', prefix: 'permanent', required: true },
        { name: 'same_as_permanent', label: ['अस्थायी ठेगाना स्थायी ठेगाना जस्तै हो', 'Temporary address is the same as permanent'], type: 'checkbox', store: 'none' },
        { name: 'temporary_address', label: ['अस्थायी ठेगाना', 'Temporary address'], type: 'address', prefix: 'temporary', sameAs: { toggle: 'same_as_permanent', from: 'permanent' }, hint: ['फरक भएमा मात्र भर्नुहोस्', 'Fill only if different'] },
      ] },
      { title: ['परिचय पत्र', 'Identity'], fields: [
        { name: 'citizenship_no', label: ['नागरिकता नम्बर', 'Citizenship number'], required: true },
        { name: 'citizenship_issued_date', label: ['जारी मिति (वि.सं.)', 'Issued date (BS)'], type: 'bsdate' },
        { name: 'citizenship_issued_place', label: ['जारी जिल्ला', 'Issue district'], type: 'select', optionsFrom: 'districts' },
        { name: 'national_id_number', label: ['राष्ट्रिय परिचयपत्र (NID) नम्बर', 'National ID number'], digits: true, hint: ['नेपाल: १४ अङ्क; नागरिकता नम्बरसँग उस्तै हुनु हुँदैन', 'Nepal: 14 digits, not the same as the citizenship number'] },
        { name: 'risk_category', label: ['KYC जोखिम श्रेणी', 'KYC risk category'], type: 'select', required: true, options: [['low', 'न्यून जोखिम (३ वर्षपछि पुनरावलोकन)', 'Low risk (review after 3 years)'], ['medium', 'मध्यम जोखिम (२ वर्षपछि पुनरावलोकन)', 'Medium risk (review after 2 years)'], ['high', 'उच्च जोखिम (१ वर्षपछि पुनरावलोकन)', 'High risk (review after 1 year)']] },
      ] },
      { title: ['पारिवारिक विवरण', 'Family'], fields: [
        { name: 'family_details_json', label: ['परिवारका सदस्य', 'Family members'], type: 'family', relations: FAMILY_RELATIONS },
      ] },
      { title: ['पेशागत विवरण', 'Occupation'], fields: [
        { name: 'occupation', label: ['पेशा', 'Occupation'], type: 'select', options: [['government', 'सरकारी नोकरी', 'Government job'], ['private', 'निजी नोकरी', 'Private job'], ['business', 'व्यापार/व्यवसाय', 'Business'], ['agriculture', 'कृषि', 'Agriculture'], ['student', 'विद्यार्थी', 'Student'], ['housewife', 'गृहिणी', 'Housewife'], ['retired', 'सेवानिवृत्त', 'Retired'], ['foreign', 'वैदेशिक रोजगार', 'Foreign employment'], ['other', 'अन्य', 'Other']] },
        { name: 'organization_name', label: ['संस्थाको नाम', 'Organisation'] },
        { name: 'monthly_income', label: ['मासिक आय', 'Monthly income'], type: 'select', options: [['below_20000', 'रु. २०,००० भन्दा कम', 'Below Rs. 20,000'], ['20000_50000', 'रु. २०,००० - ५०,०००', 'Rs. 20,000 - 50,000'], ['50000_100000', 'रु. ५०,००० - १,००,०००', 'Rs. 50,000 - 1,00,000'], ['above_100000', 'रु. १,००,००० भन्दा माथि', 'Above Rs. 1,00,000']] },
        ...[
          ['occupation_location', 'पेशा/व्यवसाय स्थान', 'Business location'], ['occupation_business_name', 'पेशा/व्यवसायको नाम', 'Business name'],
          ['business_pan_no', 'व्यवसाय PAN नं.', 'Business PAN no.'],
        ].map(([name, np, en]) => ({ name, label: [np, en], store: 'aml', showIf: BUSINESS })),
        { name: 'business_registration_type', label: ['व्यवसाय दर्ता प्रकार', 'Business registration type'], type: 'select', store: 'aml', showIf: BUSINESS, options: [['sole_proprietor', 'एकल स्वामित्व', 'Sole proprietor'], ['partnership', 'साझेदारी', 'Partnership'], ['private_limited', 'प्राइभेट लिमिटेड', 'Private limited'], ['cooperative', 'सहकारी', 'Cooperative'], ['industry_firm', 'उद्योग/फर्म', 'Industry / firm'], ['other', 'अन्य', 'Other']] },
        { name: 'business_registration_no', label: ['व्यवसाय दर्ता नं.', 'Business registration no.'], store: 'aml', showIf: BUSINESS },
        { name: 'business_registration_office', label: ['दर्ता निकाय', 'Registration office'], type: 'select', store: 'aml', showIf: BUSINESS, options: [['घरेलु', 'घरेलु', 'Cottage & small industries'], ['company_registrar', 'कम्पनी रजिस्ट्रार', 'Company registrar'], ['rajaswo_karyalaya', 'राजस्व कार्यालय', 'Revenue office'], ['nagarpalika', 'नगरपालिका', 'Municipality'], ['gaupalika', 'गाउँपालिका', 'Rural municipality'], ['other', 'अन्य', 'Other']] },
        { name: 'business_registration_date_bs', label: ['व्यवसाय दर्ता मिति (वि.सं.)', 'Business registration date (BS)'], type: 'bsdate', store: 'aml', showIf: BUSINESS },
        { name: 'business_nature', label: ['व्यवसायको प्रकृति', 'Nature of business'], store: 'aml', showIf: BUSINESS },
        { name: 'estimated_annual_income', label: ['अनुमानित वार्षिक आय', 'Estimated annual income'], store: 'aml', showIf: BUSINESS },
      ] },
      { title: ['AML/CFT थप विवरण', 'AML/CFT details'], fields: [
        { name: 'passport_no', label: ['राहदानी नं.', 'Passport no.'], store: 'aml' },
        { name: 'pan_no', label: ['PAN नं.', 'PAN no.'], store: 'aml' },
        { name: 'driving_license_no', label: ['सवारी चालक अनुमतिपत्र नं.', 'Driving licence no.'], store: 'aml' },
        { name: 'education_qualification', label: ['शैक्षिक योग्यता', 'Education'], type: 'select', store: 'aml', options: [['निरक्षर', 'निरक्षर', 'Illiterate'], ['सामान्य लेखपढ', 'सामान्य लेखपढ', 'Literate'], ['SEE', 'SEE', 'SEE'], ['+2', '+2', '+2'], ['स्नातक', 'स्नातक', 'Bachelor'], ['स्नातकोत्तर', 'स्नातकोत्तर', 'Master'], ['MPhil/PhD', 'MPhil/PhD', 'MPhil/PhD'], ['other', 'अन्य', 'Other']] },
        { name: 'religion', label: ['धर्म', 'Religion'], type: 'select', store: 'aml', options: ['हिन्दु:Hindu', 'बौद्ध:Buddhist', 'किराँत:Kirat', 'इस्लाम:Islam', 'क्रिश्चियन:Christian', 'अन्य:Other'].map(x => { const [np, en] = x.split(':'); return [np, np, en]; }) },
        { name: 'caste', label: ['जात', 'Caste / ethnicity'], type: 'select', store: 'aml', options: ['ब्राह्मण:Brahmin', 'क्षेत्री:Chhetri', 'नेवार:Newar', 'जनजाति:Janajati', 'दलित:Dalit', 'मधेसी:Madhesi', 'थारु:Tharu', 'मुस्लिम:Muslim', 'अन्य:Other'].map(x => { const [np, en] = x.split(':'); return [np, np, en]; }) },
        { type: 'heading', name: '_h_dec', label: ['घोषणा तथा बसोबास', 'Declarations & residence'] },
        { name: 'politically_exposed', label: ['राजनीतिक रूपमा आबद्ध व्यक्ति (PEP) हो?', 'Politically exposed person (PEP)?'], type: 'select', store: 'aml', options: YES_NO },
        { name: 'past_crime_declared', label: ['विगतमा कुनै अपराधमा दोषी ठहर भएको?', 'Ever convicted of a crime?'], type: 'select', store: 'aml', options: YES_NO },
        { name: 'is_rented', label: ['भाडामा बस्ने हो?', 'Living in a rented home?'], type: 'select', store: 'aml', options: YES_NO },
        { name: 'landlord_name', label: ['घरधनीको नाम', "Landlord's name"], store: 'aml', showIf: { field: 'is_rented', eq: 'yes' } },
        { name: 'landlord_contact', label: ['घरधनी सम्पर्क नं.', "Landlord's phone"], store: 'aml', showIf: { field: 'is_rented', eq: 'yes' } },
        { name: 'voter_id_card_no', label: ['मतदाता परिचयपत्र नं.', 'Voter ID no.'], store: 'aml' },
        { name: 'polling_station', label: ['मतदान स्थल', 'Polling station'], store: 'aml' },
        { name: 'member_purpose', label: ['सदस्यता लिने मुख्य उद्देश्य', 'Main purpose of membership'], store: 'aml' },
        { name: 'self_other_coop_member', label: ['अन्य सहकारीको सदस्य हुनुहुन्छ?', 'Member of another cooperative?'], type: 'select', store: 'aml', options: YES_NO },
        { name: 'self_other_coop_details', label: ['अन्य सहकारी विवरण (संस्था/सदस्यता नं./भूमिका)', 'Other cooperative (name / member no. / role)'], store: 'aml', showIf: { field: 'self_other_coop_member', eq: 'yes' } },
        { name: 'family_same_coop_member', label: ['परिवारका सदस्य यसै संस्थामा छन्?', 'Family member in this cooperative?'], type: 'select', store: 'aml', options: YES_NO },
        { name: 'family_same_member_name', label: ['परिवार सदस्यको नाम', 'Family member name'], store: 'aml', showIf: { field: 'family_same_coop_member', eq: 'yes' } },
        { name: 'family_same_member_id', label: ['उनको सदस्यता नं.', 'Their Member ID'], store: 'aml', showIf: { field: 'family_same_coop_member', eq: 'yes' } },
        { name: 'family_same_coop_details', label: ['परिवार सदस्य विवरण', 'Family member details'], store: 'aml', showIf: { field: 'family_same_coop_member', eq: 'yes' } },
        { type: 'heading', name: '_h_fin', label: ['वित्तीय कारोबार', 'Financial transactions'] },
        ...[
          ['annual_debit_credit_estimate', 'वार्षिक डेबिट/क्रेडिट अनुमान', 'Annual debit/credit estimate'], ['annual_turnover_numbers', 'वार्षिक कारोबार संख्या', 'Annual number of transactions'],
          ['annual_deposit_estimate', 'वार्षिक जम्मा अनुमान', 'Annual deposit estimate'], ['institution_debt_estimate', 'संस्थासँग ऋण अनुमान', 'Expected borrowing'],
          ['annual_family_income', 'वार्षिक पारिवारिक आम्दानी', 'Annual family income'], ['net_worth_details', 'सम्पत्ति / Net worth विवरण', 'Net worth'],
        ].map(([name, np, en]) => ({ name, label: [np, en], store: 'aml' })),
      ] },
      { title: ['नजिकको व्यक्ति / हकवाला (Nominee)', 'Nearest person & nominee'], fields: [
        { name: 'nearest_person_name', label: ['नजिकको व्यक्तिको नाम', 'Nearest person'], store: 'aml' },
        { name: 'nearest_person_relation', label: ['नाता', 'Relation'], store: 'aml' },
        { name: 'nominee_name', label: ['हकवालाको नाम', 'Nominee name'], store: 'aml', hint: ['परिवार सूचीबाट पनि छान्न सकिन्छ', 'You can also pick from the family list'], nomineePicker: true },
        { name: 'nominee_relation', label: ['हकवालासँग नाता', 'Relation to nominee'], type: 'select', store: 'aml', options: ['पति/पत्नी:Spouse', 'छोरा:Son', 'छोरी:Daughter', 'बुबा:Father', 'आमा:Mother', 'दाजु/भाइ:Brother', 'दिदी/बहिनी:Sister', 'अभिभावक:Guardian', 'अन्य:Other'].map(x => { const [np, en] = x.split(':'); return [np, np, en]; }) },
        { name: 'nominee_dob', label: ['हकवालाको जन्म मिति (वि.सं.)', 'Nominee date of birth (BS)'], type: 'bsdate', store: 'aml' },
        { name: 'nominee_citizenship_no', label: ['हकवालाको नागरिकता नं.', 'Nominee citizenship no.'], store: 'aml' },
        { name: 'nominee_issue_district', label: ['हकवाला नागरिकता जारी जिल्ला', 'Nominee issue district'], type: 'select', optionsFrom: 'districts', store: 'aml' },
        { name: 'nominee_issue_date', label: ['हकवाला जारी मिति (वि.सं.)', 'Nominee issue date (BS)'], type: 'bsdate', store: 'aml' },
        { name: 'nominee_permanent_address', label: ['हकवालाको स्थायी ठेगाना', 'Nominee permanent address'], store: 'aml' },
        { name: 'nominee_temporary_address', label: ['हकवालाको अस्थायी ठेगाना', 'Nominee temporary address'], store: 'aml' },
      ] },
      { title: ['स्थान र आय/खर्च', 'Location, income & expenses'], fields: [
        { name: 'longitude_latitude', label: ['घरको स्थान (अक्षांश, देशान्तर)', 'Home location (lat, lng)'], type: 'geo', store: 'aml' },
        { name: 'map_resolved_address', label: ['नक्साबाट प्राप्त ठेगाना', 'Address from the map'], store: 'aml' },
        { name: 'other_attached_docs', label: ['अन्य संलग्न कागजात', 'Other attached documents'], store: 'aml', hint: ['जस्तै: विवाह दर्ता, बसाइँसराइ', 'e.g. marriage or migration certificate'] },
        { name: 'income_source', label: ['मासिक आय स्रोतहरू', 'Monthly income sources'], type: 'moneyitems' },
        { name: 'expense_source', label: ['मासिक खर्च स्रोतहरू', 'Monthly expenses'], type: 'moneyitems' },
      ] },
      { title: ['खाता', 'Account'], fields: [
        { name: 'account_type', label: ['खाताको प्रकार', 'Account type'], type: 'select', options: [['saving', 'बचत खाता', 'Saving account'], ['current', 'चल्ती खाता', 'Current account'], ['fixed', 'मुद्दती खाता', 'Fixed deposit'], ['recurring', 'आवधिक बचत', 'Recurring deposit']] },
        BRANCH,
      ] },
      { title: ['कागजात र बायोमेट्रिक', 'Documents & biometrics'], fields: [
        { name: 'photo', label: ['पासपोर्ट साइज फोटो', 'Passport photo'], type: 'image', capture: 'user', newRequired: true, hint: ['अनुहार सिधा, राम्रो उज्यालो; दुवै आँखा र कान देखिनुपर्छ', 'Face straight, good light; both eyes and ears visible'] },
        { name: 'passport_face_confirm', label: ['फोटोमा दुवै आँखा र दुवै कान स्पष्ट देखिएका छन् भनी पुष्टि गर्छु', 'I confirm both eyes and both ears are clearly visible'], type: 'checkbox', store: 'none' },
        { name: 'citizenship_front', label: ['नागरिकता (अगाडि)', 'Citizenship (front)'], type: 'image', capture: 'environment', newRequired: true },
        { name: 'citizenship_back', label: ['नागरिकता (पछाडि)', 'Citizenship (back)'], type: 'image', capture: 'environment', newRequired: true },
        { name: 'national_id_card', label: ['राष्ट्रिय परिचयपत्र (NID)', 'National ID card'], type: 'image', capture: 'environment' },
        { name: 'signature', label: ['हस्ताक्षर', 'Signature'], type: 'image', newRequired: true },
        { name: 'left_thumb', label: ['बायाँ औंठा छाप', 'Left thumb print'], type: 'image', capture: 'environment' },
        { name: 'right_thumb', label: ['दायाँ औंठा छाप', 'Right thumb print'], type: 'image', capture: 'environment' },
        { name: 'want_id_card', label: ['हो, मलाई डिजिटल सदस्य परिचयपत्र चाहिन्छ (केवाइएम स्वीकृत भएपछि स्वतः तयार हुन्छ)', 'Yes, I want a digital member ID card (issued automatically after approval)'], type: 'checkbox' },
        { name: 'declaration', label: ['मैले माथि दिएको सबै विवरण सत्य र सही छ भनी घोषणा गर्दछु।', 'I declare that the information above is true and correct.'], type: 'checkbox', required: true, store: 'none' },
      ] },
    ],
  },

  grievance: {
    table: 'grievances', prefix: 'GR', icon: 'message', nameCol: 'name', phoneCol: 'phone', memberCol: 'member_id',
    title: ['गुनासो दर्ता', 'Register a grievance'], remarksCol: 'admin_response',
    intro: ['तपाईंको गुनासो गोप्य राखिनेछ। ट्र्याकिङ नम्बरबाट स्थिति हेर्न सक्नुहुन्छ।', 'Your grievance is kept confidential. Use the tracking number to follow it.'],
    sections: [{ fields: [
      { name: 'name', label: ['नाम', 'Name'], required: true, show: true },
      { name: 'member_id', label: ['सदस्यता नं. (भए)', 'Membership no. (if any)'] },
      { name: 'phone', label: ['फोन', 'Phone'], type: 'tel', required: true, show: true },
      { name: 'email', label: ['इमेल', 'Email'], type: 'email' },
      { name: 'category', label: ['विषय क्षेत्र', 'Category'], type: 'select', show: true, options: [['service', 'सेवा', 'Service'], ['staff', 'कर्मचारी', 'Staff'], ['loan', 'ऋण', 'Loan'], ['account', 'खाता', 'Account'], ['branch', 'शाखा', 'Branch'], ['other', 'अन्य', 'Other']] },
      { name: 'subject', label: ['शीर्षक', 'Subject'], required: true, show: true },
      { name: 'description', label: ['विवरण', 'Details'], type: 'textarea', rows: 5, required: true },
      { name: 'attachment', label: ['प्रमाण (भए)', 'Evidence (optional)'], type: 'file', kind: 'any' },
      { name: 'is_anonymous', label: ['मेरो नाम गोप्य राख्नुहोस्', 'Keep my name confidential'], type: 'checkbox' },
    ] }],
  },

  appointment: {
    table: 'appointments', prefix: 'AP', icon: 'calendar', nameCol: 'name', phoneCol: 'phone', memberCol: 'member_id',
    title: ['भेटघाट समय लिनुहोस्', 'Book an appointment'],
    intro: ['भेटघाटको समय निश्चित भएपछि हामी फोन गर्नेछौं।', 'We will call to confirm your time.'],
    sections: [{ fields: [
      { name: 'visit_kind', label: ['भेटघाटको प्रकार', 'Visit type'], type: 'radio', default: 'member', options: [['member', 'सदस्य / व्यक्तिगत भेट', 'Member / personal visit'], ['cooperative', 'सहकारी / संस्थागत भ्रमण', 'Cooperative / organisation visit']] },
      { name: 'name', label: ['नाम (संस्थागत भ्रमणमा संस्थाको नाम)', 'Name (organisation name for a visit)'], required: true, show: true },
      { name: 'contact_person', label: ['सम्पर्क व्यक्ति', 'Contact person'], showIf: COOP_VISIT, requiredWhenShown: true },
      { name: 'organization_address', label: ['संस्थाको ठेगाना', 'Organisation address'], showIf: COOP_VISIT, requiredWhenShown: true },
      { name: 'organization_website', label: ['वेबसाइट', 'Website'], type: 'url', showIf: COOP_VISIT },
      { name: 'phone', label: ['फोन', 'Phone'], type: 'tel', required: true, show: true },
      { name: 'email', label: ['इमेल', 'Email'], type: 'email' },
      { name: 'member_id', label: ['सदस्यता नं.', 'Membership no.'], showIf: { field: 'visit_kind', ne: 'cooperative' } },
      { name: 'purpose', label: ['प्रयोजन', 'Purpose'], type: 'select', show: true, showIf: { field: 'visit_kind', ne: 'cooperative' }, requiredWhenShown: true, options: [['account', 'खाता', 'Account'], ['loan', 'ऋण', 'Loan'], ['membership', 'सदस्यता', 'Membership'], ['meeting', 'व्यवस्थापनसँग भेट', 'Meet management'], ['other', 'अन्य', 'Other']] },
      { name: 'preferred_date', label: ['मिति', 'Date'], type: 'date', required: true, show: true, futureOnly: true },
      { name: 'preferred_time', label: ['समय', 'Time'], type: 'select', required: true, options: [['10:00', '१०:००', '10:00'], ['11:00', '११:००', '11:00'], ['12:00', '१२:००', '12:00'], ['13:00', '१:००', '1:00 PM'], ['14:00', '२:००', '2:00 PM'], ['15:00', '३:००', '3:00 PM'], ['16:00', '४:००', '4:00 PM']] },
      BRANCH,
      { name: 'purpose_detail', label: ['थप विवरण (भ्रमणको उद्देश्य)', 'Details (purpose of the visit)'], type: 'textarea', rows: 3 },
    ] }],
  },

  feedback: {
    table: 'member_feedback', prefix: 'FB', icon: 'message', nameCol: 'name', phoneCol: 'phone', memberCol: 'member_id', remarksCol: 'admin_reply',
    title: ['सुझाव तथा प्रतिक्रिया', 'Feedback & suggestions'],
    sections: [{ fields: [
      { name: 'name', label: ['नाम', 'Name'], required: true, show: true },
      { name: 'phone', label: ['फोन', 'Phone'], type: 'tel', show: true },
      { name: 'email', label: ['इमेल', 'Email'], type: 'email' },
      { name: 'member_id', label: ['सदस्यता नं.', 'Membership no.'] },
      { name: 'type', label: ['प्रकार', 'Type'], type: 'select', show: true, options: [['feedback', 'प्रतिक्रिया', 'Feedback'], ['suggestion', 'सुझाव', 'Suggestion'], ['complaint', 'उजुरी', 'Complaint'], ['inquiry', 'जिज्ञासा', 'Inquiry']] },
      { name: 'subject', label: ['विषय', 'Subject'], required: true, show: true },
      { name: 'message', label: ['सन्देश', 'Message'], type: 'textarea', rows: 5, required: true },
    ] }],
  },

  welfare: {
    table: 'member_welfare_claims', prefix: 'WC', icon: 'heart', nameCol: 'member_name', phoneCol: 'phone', memberCol: 'member_id', remarksCol: 'admin_remarks',
    title: ['सदस्य कल्याण दाबी', 'Member welfare claim'], memberOnly: false,
    sections: [{ fields: [
      { name: 'member_name', label: ['सदस्यको नाम', 'Member name'], required: true, show: true },
      { name: 'member_id', label: ['सदस्यता नं.', 'Membership no.'], required: true, show: true },
      { name: 'phone', label: ['फोन', 'Phone'], type: 'tel', required: true },
      { name: 'email', label: ['इमेल', 'Email'], type: 'email' },
      { name: 'address', label: ['ठेगाना', 'Address'] },
      { name: 'claim_type', label: ['दाबीको प्रकार', 'Claim type'], type: 'select', required: true, show: true, optionsFrom: 'welfareTypes' },
      { name: 'claim_amount', label: ['दाबी रकम (रु.)', 'Amount (Rs.)'], type: 'number', format: 'money', show: true },
      { name: 'claim_date_bs', label: ['घटना मिति (वि.सं.)', 'Event date (BS)'], type: 'bsdate', adCol: 'claim_date_ad' },
    ] }, { title: ['दाबी सम्बन्धी विवरण', 'Claim details'], fields: [
      { name: 'delivery_date', label: ['प्रसूति मिति', 'Delivery date'], type: 'date', showIf: WELFARE(['maternity']) },
      { name: 'hospital_name', label: ['अस्पताल/क्लिनिक', 'Hospital / clinic'], showIf: WELFARE(['maternity']) },
      { name: 'deceased_name', label: ['मृतकको नाम', 'Deceased name'], showIf: WELFARE(['death']) },
      { name: 'deceased_relation', label: ['मृतकसँगको नाता', 'Relation to deceased'], type: 'select', showIf: WELFARE(['death']), options: [['self', 'स्वयं', 'Self'], ['spouse', 'पति/पत्नी', 'Spouse'], ['father', 'बुबा', 'Father'], ['mother', 'आमा', 'Mother'], ['son', 'छोरा', 'Son'], ['daughter', 'छोरी', 'Daughter'], ['other', 'अन्य', 'Other']] },
      { name: 'death_date', label: ['मृत्यु मिति', 'Date of death'], type: 'date', showIf: WELFARE(['death']) },
      { name: 'death_certificate', label: ['मृत्यु प्रमाणपत्र', 'Death certificate'], type: 'file', kind: 'any', showIf: WELFARE(['death']) },
      { name: 'beneficiary_name', label: ['लाभग्राहीको नाम', 'Beneficiary name'], showIf: WELFARE(['death']) },
      { name: 'beneficiary_relation', label: ['लाभग्राहीको नाता', 'Beneficiary relation'], showIf: WELFARE(['death']) },
      { name: 'disease_illness', label: ['रोग / समस्या', 'Disease / illness'], showIf: WELFARE(['medical', 'accident']) },
      { name: 'treatment_date', label: ['उपचार मिति', 'Treatment date'], type: 'date', showIf: WELFARE(['medical', 'accident']) },
      { name: 'hospital_clinic', label: ['अस्पताल / क्लिनिक', 'Hospital / clinic'], showIf: WELFARE(['medical', 'accident']) },
      { name: 'policy_number', label: ['पोलिसी नम्बर', 'Policy number'], showIf: WELFARE(['insurance']) },
      { name: 'insurer_name', label: ['बीमा कम्पनी', 'Insurer'], showIf: WELFARE(['insurance']) },
      { name: 'description', label: ['विवरण', 'Details'], type: 'textarea', rows: 4, required: true },
      { name: 'attachment_path', label: ['प्रमाण कागजात', 'Supporting document'], type: 'file', kind: 'any', requiredIf: { field: 'claim_type', meta: 'requires_document' } },
    ] }],
  },

  digital: {
    table: 'digital_service_requests', prefix: 'DS', icon: 'phone', nameCol: 'requester_name', phoneCol: 'phone', memberCol: 'member_id', remarksCol: 'admin_remarks',
    title: ['डिजिटल सेवा अनुरोध', 'Digital service request'],
    intro: ['मोबाइल बैंकिङ, स्टेटमेन्ट, QR, कार्ड लगायत सेवाको अनुरोध।', 'Request mobile banking, statements, QR, cards and more.'],
    sections: [{ fields: [
      { name: 'service_type', label: ['सेवा', 'Service'], type: 'select', required: true, show: true, optionsFrom: 'digitalTypes' },
      { name: 'requester_name', label: ['नाम', 'Name'], required: true, show: true },
      { name: 'member_id', label: ['सदस्यता नं.', 'Membership no.'] },
      { name: 'account_number', label: ['खाता नं.', 'Account no.'] },
      { name: 'phone', label: ['फोन', 'Phone'], type: 'tel', required: true, show: true },
      { name: 'email', label: ['इमेल', 'Email'], type: 'email' },
      { name: 'statement_from', label: ['स्टेटमेन्ट देखि', 'Statement from'], type: 'date' },
      { name: 'statement_to', label: ['स्टेटमेन्ट सम्म', 'Statement to'], type: 'date' },
      { name: 'preferred_contact', label: ['सम्पर्क माध्यम', 'Contact via'], type: 'radio', options: [['phone', 'फोन', 'Phone'], ['email', 'इमेल', 'Email'], ['branch', 'शाखा', 'Branch']] },
      { name: 'request_details', label: ['थप विवरण', 'Details'], type: 'textarea', rows: 3 },
      { name: 'attachment', label: ['कागजात', 'Document'], type: 'file', kind: 'any', requiredIf: { field: 'service_type', meta: 'requires_document' } },
    ] }],
  },

  vendor: {
    table: 'vendors', prefix: 'VN', icon: 'briefcase', nameCol: 'company_name', phoneCol: 'phone',
    title: ['आपूर्तिकर्ता सूचीकरण', 'Vendor enlistment'],
    sections: [{ fields: [
      { name: 'company_name', label: ['फर्म/कम्पनीको नाम', 'Company name'], required: true, show: true },
      { name: 'owner_name', label: ['प्रोपाइटर', 'Owner'], required: true, show: true },
      { name: 'pan_no', label: ['PAN/VAT नं.', 'PAN/VAT no.'], required: true },
      { name: 'business_type', label: ['व्यवसायको प्रकार', 'Business type'], show: true },
      { name: 'phone', label: ['फोन', 'Phone'], type: 'tel', required: true },
      { name: 'email', label: ['इमेल', 'Email'], type: 'email' },
      { name: 'address', label: ['ठेगाना', 'Address'] },
      { name: 'description', label: ['उपलब्ध गराउने सामान/सेवा', 'Goods / services offered'], type: 'textarea', rows: 4 },
    ] }],
  },

  survey: {
    table: 'member_survey', prefix: 'SV', icon: 'star', nameCol: 'member_name', phoneCol: 'phone', memberCol: 'member_id', noStatus: true,
    title: ['सदस्य सन्तुष्टि सर्वेक्षण', 'Member satisfaction survey'],
    sections: [{ fields: [
      { name: 'member_name', label: ['नाम', 'Name'], required: true, show: true },
      { name: 'member_id', label: ['सदस्यता नं.', 'Membership no.'] },
      { name: 'phone', label: ['फोन', 'Phone'], type: 'tel' },
      { name: 'email', label: ['इमेल', 'Email'], type: 'email' },
      { name: 'satisfaction_level', label: ['समग्र सन्तुष्टि', 'Overall satisfaction'], type: 'rating', required: true, show: true },
      { name: 'service_quality', label: ['सेवाको गुणस्तर', 'Service quality'], type: 'rating' },
      { name: 'staff_behavior', label: ['कर्मचारीको व्यवहार', 'Staff behaviour'], type: 'rating' },
      { name: 'response_time', label: ['सेवा पाउन लाग्ने समय', 'Response time'], type: 'rating' },
      { name: 'suggestions', label: ['सुझाव', 'Suggestions'], type: 'textarea', rows: 4 },
    ] }],
  },

  membership: {
    table: 'membership_applications', prefix: 'MB', icon: 'users', nameCol: 'full_name', phoneCol: 'mobile', remarksCol: 'admin_remarks',
    title: ['सदस्यता आवेदन', 'Membership application'],
    intro: ['सहकारीको सदस्य बन्न आवेदन दिनुहोस्।', 'Apply to become a member.'],
    sections: [{ fields: [
      { name: 'full_name', label: ['पूरा नाम', 'Full name'], required: true, show: true },
      { name: 'mobile', label: ['मोबाइल', 'Mobile'], type: 'tel', required: true, show: true },
      { name: 'email', label: ['इमेल', 'Email'], type: 'email' },
      { name: 'citizenship_no', label: ['नागरिकता नं.', 'Citizenship no.'], required: true },
      { name: 'address', label: ['ठेगाना', 'Address'], type: 'textarea', rows: 2, required: true, show: true },
      { name: 'remarks', label: ['कैफियत', 'Remarks'], type: 'textarea', rows: 3 },
    ] }],
  },

  honor: {
    table: 'honor_applications', prefix: 'HN', icon: 'award', nameCol: 'applicant_name', phoneCol: 'phone', memberCol: 'member_id', remarksCol: 'admin_remarks', hidden: true,
    title: ['सम्मान/पुरस्कार आवेदन', 'Honour application'],
    sections: [{ fields: [
      { name: 'program_id', label: ['कार्यक्रम', 'Programme'], type: 'select', required: true, optionsFrom: 'honorPrograms', show: true },
      { name: 'category_id', label: ['विधा', 'Category'], type: 'select', required: true, optionsFrom: 'honorCategories', filterBy: { field: 'program_id', meta: 'programs' } },
      { name: 'applicant_name', label: ['आवेदकको नाम', 'Applicant'], required: true, show: true },
      { name: 'phone', label: ['फोन', 'Phone'], type: 'tel', required: true, show: true },
      { name: 'email', label: ['इमेल', 'Email'], type: 'email' },
      { name: 'address', label: ['ठेगाना', 'Address'] },
      { name: 'member_id', label: ['सदस्यता नं.', 'Membership no.'] },
      { name: 'nominee_name', label: ['विद्यार्थी/मनोनीतको नाम', 'Nominee / student name'], requiredIf: { field: 'category_id', meta: 'requires_nominee' } },
      { name: 'nominee_relation', label: ['नाता', 'Relation'] },
      { name: 'institution', label: ['शिक्षण संस्था', 'Institution'] },
      { name: 'exam_year', label: ['परीक्षा वर्ष', 'Exam year'] },
      { name: 'description', label: ['विवरण', 'Details'], type: 'textarea', rows: 3 },
      { name: 'attachment', label: ['प्रमाणपत्र', 'Certificate'], type: 'file', kind: 'any', requiredIf: { field: 'category_id', meta: 'requires_document' } },
    ] }],
  },

  job: {
    table: 'job_applications', prefix: 'JB', icon: 'briefcase', nameCol: 'full_name', phoneCol: 'phone', remarksCol: 'admin_notes', hidden: true,
    title: ['रोजगारीका लागि आवेदन', 'Job application'],
    sections: [{ fields: [
      { name: 'career_id', label: ['पद', 'Position'], type: 'select', required: true, optionsFrom: 'careers', show: true },
      { name: 'full_name', label: ['पूरा नाम', 'Full name'], required: true, show: true },
      { name: 'phone', label: ['फोन', 'Phone'], type: 'tel', required: true, show: true },
      { name: 'email', label: ['इमेल', 'Email'], type: 'email', required: true },
      { name: 'address', label: ['ठेगाना', 'Address'] },
      { name: 'date_of_birth', label: ['जन्म मिति (AD)', 'Date of birth'], type: 'date' },
      GENDER,
      { name: 'education', label: ['शैक्षिक योग्यता', 'Education'], required: true },
      { name: 'experience', label: ['अनुभव', 'Experience'] },
      { name: 'current_employer', label: ['हालको संस्था', 'Current employer'] },
      { name: 'expected_salary', label: ['अपेक्षित तलब', 'Expected salary'] },
      { name: 'cover_letter', label: ['निवेदन', 'Cover letter'], type: 'textarea', rows: 5 },
      { name: 'resume_path', label: ['बायोडाटा (PDF)', 'CV (PDF)'], type: 'file', kind: 'doc', required: true },
      { name: 'photo_path', label: ['फोटो', 'Photo'], type: 'image' },
      { name: 'citizenship_path', label: ['नागरिकता', 'Citizenship'], type: 'file', kind: 'any' },
    ] }],
  },

  bid: {
    table: 'auction_bids', prefix: 'BD', icon: 'gavel', nameCol: 'bidder_name', phoneCol: 'bidder_phone', hidden: true, noTracking: true,
    title: ['बोलकबोल', 'Place a bid'],
    sections: [{ fields: [
      { name: 'auction_id', label: ['लिलाम', 'Auction'], type: 'select', required: true, optionsFrom: 'auctions', show: true },
      { name: 'bidder_name', label: ['नाम', 'Name'], required: true, show: true },
      { name: 'bidder_phone', label: ['फोन', 'Phone'], type: 'tel', required: true, show: true },
      { name: 'bidder_email', label: ['इमेल', 'Email'], type: 'email' },
      { name: 'bidder_address', label: ['ठेगाना', 'Address'] },
      { name: 'bid_amount', label: ['कबोल रकम (रु.)', 'Bid amount (Rs.)'], type: 'number', required: true, min: 1, format: 'money', show: true },
      { name: 'message', label: ['सन्देश', 'Message'], type: 'textarea', rows: 3 },
    ] }],
  },

  contact: {
    table: 'contact_messages', prefix: 'CT', icon: 'mail', nameCol: 'name', phoneCol: 'phone', noTracking: true, noStatus: true, hidden: true,
    title: ['सम्पर्क सन्देश', 'Contact message'],
    sections: [{ fields: [
      { name: 'name', label: ['नाम', 'Name'], required: true, show: true },
      { name: 'phone', label: ['फोन', 'Phone'], type: 'tel', show: true },
      { name: 'email', label: ['इमेल', 'Email'], type: 'email' },
      { name: 'subject', label: ['विषय', 'Subject'], required: true, show: true },
      { name: 'message', label: ['सन्देश', 'Message'], type: 'textarea', rows: 5, required: true },
    ] }],
  },
};

const EXTRA = {
  loan: { adminOnly: true, attachCol: 'admin_attachment', adminEvent: 'loan_application', memberEvent: 'loan', amountCol: 'loan_amount' },
  account: { adminOnly: true, attachCol: 'admin_attachment', adminEvent: 'account_application', memberEvent: 'account' },
  kyc: { adminOnly: true, attachCol: 'admin_attachment', adminEvent: 'kyc_application', memberEvent: 'kyc' },
  grievance: { adminOnly: true, attachCol: 'admin_attachment', noteCol: 'admin_note', adminEvent: 'grievance', memberEvent: 'grievance' },
  appointment: { attachCol: 'admin_attachment', adminEvent: 'appointment', memberEvent: 'appointment', dateCol: 'preferred_date' },
  digital: { adminOnly: true, attachCol: 'admin_attachment', adminEvent: 'digital_service', memberEvent: 'digital_service' },
  job: { adminOnly: true, adminEvent: 'job_application' },
  feedback: { noteCol: 'admin_note' },
  honor: { adminEvent: 'honor_application', memberEvent: 'honor_application' },
  welfare: { adminEvent: 'welfare_claim', amountCol: 'claim_amount' },
  membership: { adminEvent: 'membership_application' },
  contact: { adminEvent: 'contact_message' },
};

for (const [key, m] of Object.entries(modules)) {
  Object.assign(m, EXTRA[key] || {});
  m.key = key;
  m.fields = m.sections.flatMap(s => s.fields);
  m.fileFields = m.fields.filter(f => f.type === 'file' || f.type === 'image');
  m.wantsAddressData = m.fields.some(f => f.type === 'address');
  m.remarksCol = m.remarksCol || 'remarks';
}

module.exports = modules;
