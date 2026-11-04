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
    table: 'kyc_applications', prefix: 'KY', icon: 'id', nameCol: 'full_name', phoneCol: 'mobile', memberCol: 'member_id',
    title: ['अनलाइन KYC', 'Online KYC'],
    intro: ['आफ्नो KYC विवरण अद्यावधिक गर्नुहोस्।', 'Update your KYC details.'],
    sections: [
      { title: ['सदस्य', 'Member'], fields: [
        { name: 'member_id', label: ['सदस्यता नं.', 'Membership no.'], show: true },
        { name: 'full_name', label: ['नाम (नेपालीमा)', 'Name (Nepali)'], required: true, show: true },
        { name: 'full_name_en', label: ['नाम (अंग्रेजीमा)', 'Name (English)'] },
        { name: 'dob_bs', label: ['जन्म मिति (वि.सं.)', 'Date of birth (BS)'], type: 'bsdate', adCol: 'dob_ad' },
        GENDER,
        { name: 'marital_status', label: ['वैवाहिक स्थिति', 'Marital status'], type: 'select', options: [['single', 'अविवाहित', 'Single'], ['married', 'विवाहित', 'Married'], ['other', 'अन्य', 'Other']] },
        { name: 'nationality', label: ['नागरिकता (देश)', 'Nationality'], default: 'नेपाली' },
        { name: 'mobile', label: ['मोबाइल', 'Mobile'], type: 'tel', required: true, show: true },
        { name: 'email', label: ['इमेल', 'Email'], type: 'email' },
      ] },
      { title: ['ठेगाना र परिवार', 'Address & family'], fields: [
        { name: 'permanent_address', label: ['स्थायी ठेगाना', 'Permanent address'], type: 'textarea', rows: 2, required: true },
        { name: 'temporary_address', label: ['अस्थायी ठेगाना', 'Temporary address'], type: 'textarea', rows: 2 },
        { name: 'father_name', label: ['बुबाको नाम', "Father's name"] },
        { name: 'mother_name', label: ['आमाको नाम', "Mother's name"] },
        { name: 'grandfather_name', label: ['हजुरबुबाको नाम', "Grandfather's name"] },
        { name: 'spouse_name', label: ['पति/पत्नीको नाम', "Spouse's name"] },
        { name: 'occupation', label: ['पेशा', 'Occupation'] },
        { name: 'organization_name', label: ['संस्था', 'Organisation'] },
        { name: 'monthly_income', label: ['मासिक आम्दानी', 'Monthly income'] },
      ] },
      { title: ['नागरिकता र कागजात', 'Citizenship & documents'], fields: [
        { name: 'citizenship_no', label: ['नागरिकता नं.', 'Citizenship no.'], required: true },
        { name: 'citizenship_issued_date', label: ['जारी मिति', 'Issued date'] },
        { name: 'citizenship_issued_place', label: ['जारी जिल्ला', 'Issued district'] },
        BRANCH,
        { name: 'photo', label: ['फोटो', 'Photo'], type: 'image' },
        { name: 'citizenship_front', label: ['नागरिकता (अगाडि)', 'Citizenship (front)'], type: 'image' },
        { name: 'citizenship_back', label: ['नागरिकता (पछाडि)', 'Citizenship (back)'], type: 'image' },
        { name: 'signature', label: ['हस्ताक्षर', 'Signature'], type: 'image' },
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
      { name: 'name', label: ['नाम', 'Name'], required: true, show: true },
      { name: 'phone', label: ['फोन', 'Phone'], type: 'tel', required: true, show: true },
      { name: 'email', label: ['इमेल', 'Email'], type: 'email' },
      { name: 'member_id', label: ['सदस्यता नं.', 'Membership no.'] },
      { name: 'purpose', label: ['प्रयोजन', 'Purpose'], type: 'select', required: true, show: true, options: [['account', 'खाता', 'Account'], ['loan', 'ऋण', 'Loan'], ['membership', 'सदस्यता', 'Membership'], ['meeting', 'व्यवस्थापनसँग भेट', 'Meet management'], ['other', 'अन्य', 'Other']] },
      { name: 'preferred_date', label: ['मिति', 'Date'], type: 'date', required: true, show: true, futureOnly: true },
      { name: 'preferred_time', label: ['समय', 'Time'], type: 'select', options: [['10:00', '१०:००', '10:00'], ['11:00', '११:००', '11:00'], ['12:00', '१२:००', '12:00'], ['13:00', '१:००', '1:00 PM'], ['14:00', '२:००', '2:00 PM'], ['15:00', '३:००', '3:00 PM'], ['16:00', '४:००', '4:00 PM']] },
      BRANCH,
      { name: 'purpose_detail', label: ['थप विवरण', 'Details'], type: 'textarea', rows: 3 },
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
      { name: 'description', label: ['विवरण', 'Details'], type: 'textarea', rows: 4, required: true },
      { name: 'attachment_path', label: ['प्रमाण कागजात', 'Supporting document'], type: 'file', kind: 'any' },
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
      { name: 'attachment', label: ['कागजात (भए)', 'Document (optional)'], type: 'file', kind: 'any' },
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
      { name: 'category_id', label: ['विधा', 'Category'], type: 'select', required: true, optionsFrom: 'honorCategories' },
      { name: 'applicant_name', label: ['आवेदकको नाम', 'Applicant'], required: true, show: true },
      { name: 'phone', label: ['फोन', 'Phone'], type: 'tel', required: true, show: true },
      { name: 'email', label: ['इमेल', 'Email'], type: 'email' },
      { name: 'address', label: ['ठेगाना', 'Address'] },
      { name: 'member_id', label: ['सदस्यता नं.', 'Membership no.'] },
      { name: 'nominee_name', label: ['विद्यार्थी/मनोनीतको नाम', 'Nominee / student name'] },
      { name: 'nominee_relation', label: ['नाता', 'Relation'] },
      { name: 'institution', label: ['शिक्षण संस्था', 'Institution'] },
      { name: 'exam_year', label: ['परीक्षा वर्ष', 'Exam year'] },
      { name: 'description', label: ['विवरण', 'Details'], type: 'textarea', rows: 3 },
      { name: 'attachment', label: ['प्रमाणपत्र', 'Certificate'], type: 'file', kind: 'any' },
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

for (const [key, m] of Object.entries(modules)) {
  m.key = key;
  m.fields = m.sections.flatMap(s => s.fields);
  m.fileFields = m.fields.filter(f => f.type === 'file' || f.type === 'image');
  m.remarksCol = m.remarksCol || 'remarks';
}

module.exports = modules;
